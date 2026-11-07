// purchaseCredits.ts
import {
  IdempotencyType,
  validateIdempotencyKey,
  createErrorResponse,
  createSuccessResponse,
  createIdempotentHandler
} from "quiz-utils/idempotencyUtils";
import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { createSign } from "node:crypto";

// shopCatalog.ts
var CREDIT_PACKS = [
  { ProductId: "credits_100", Credits: 100, BonusCredits: 0 },
  { ProductId: "credits_550", Credits: 550, BonusCredits: 50 },
  { ProductId: "credits_1200", Credits: 1200, BonusCredits: 200 }
];
var SANDBOX_MAX_CREDITS = 1200;
function findCreditPack(productId) {
  return CREDIT_PACKS.find((p) => p.ProductId === productId);
}

// shopState.ts
function readShopState(playerData) {
  const credits = typeof playerData?.Credits === "number" ? playerData.Credits : 0;
  const owned = Array.isArray(playerData?.OwnedOutfits) ? playerData.OwnedOutfits.filter((v) => typeof v === "string") : [];
  const equippedRaw = playerData?.EquippedOutfits;
  const equipped = {};
  if (equippedRaw && typeof equippedRaw === "object") {
    for (const [k, v] of Object.entries(equippedRaw)) {
      if (typeof v === "string" && v.length > 0) equipped[k] = v;
    }
  }
  return { Credits: credits, OwnedOutfits: owned, EquippedOutfits: equipped };
}

// purchaseCredits.ts
var dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
var PLAYER_TABLE = "PlayerResources";
var RECEIPT_TABLE = process.env.RECEIPT_TABLE || "PurchaseReceipts";
function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function getGoogleAccessToken() {
  const email = process.env.GOOGLE_SA_EMAIL;
  const key = (process.env.GOOGLE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) {
    throw new Error("GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY not configured");
  }
  const nowSec = Math.floor(Date.now() / 1e3);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(key));
  const assertion = `${header}.${claims}.${signature}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) {
    throw new Error(`Google token request failed: ${response.status} ${await response.text()}`);
  }
  const json = await response.json();
  if (!json.access_token) {
    throw new Error("Google token response had no access_token");
  }
  return json.access_token;
}
async function verifyGooglePurchase(productId, purchaseToken) {
  const packageName = process.env.GOOGLE_PACKAGE_NAME;
  if (!packageName) {
    return { ok: false, reason: "GOOGLE_PACKAGE_NAME not configured" };
  }
  const accessToken = await getGoogleAccessToken();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 404 || response.status === 400) {
    return { ok: false, reason: `Google rejected token (${response.status})` };
  }
  if (!response.ok) {
    throw new Error(`Google purchase lookup failed: ${response.status} ${await response.text()}`);
  }
  const purchase = await response.json();
  if (purchase.purchaseState !== 0) {
    return { ok: false, reason: `purchaseState=${purchase.purchaseState}` };
  }
  if (purchase.productId && purchase.productId !== productId) {
    return { ok: false, reason: "productId mismatch" };
  }
  return { ok: true, orderId: purchase.orderId };
}
var lambdaHandler = async (event, _context) => {
  console.log("[PurchaseCredits] Lambda invoked");
  const validation = validateIdempotencyKey(event, IdempotencyType.PAYMENT_VERIFY);
  if (!validation.isValid) {
    return createErrorResponse(400, validation.error);
  }
  const userId = validation.userId;
  let productId;
  let purchaseToken;
  let platform;
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    productId = body.ProductId;
    purchaseToken = body.PurchaseToken;
    platform = body.Platform ?? "google";
  } catch {
    return createErrorResponse(400, "Invalid request body");
  }
  if (typeof productId !== "string" || productId.length === 0) {
    return createErrorResponse(400, "ProductId is required");
  }
  if (typeof purchaseToken !== "string" || purchaseToken.length === 0 || purchaseToken.length > 4096) {
    return createErrorResponse(400, "PurchaseToken is required");
  }
  if (platform !== "google" && platform !== "sandbox") {
    return createErrorResponse(400, "Unsupported platform");
  }
  const pack = findCreditPack(productId);
  if (!pack) {
    return createErrorResponse(404, "Unknown product");
  }
  if (pack.Credits > SANDBOX_MAX_CREDITS && platform === "sandbox") {
    return createErrorResponse(400, "Pack too large for sandbox");
  }
  let verified;
  if (platform === "sandbox") {
    if (process.env.ALLOW_SANDBOX_PURCHASE !== "true") {
      return createErrorResponse(403, "Sandbox purchases are disabled");
    }
    verified = { ok: true, orderId: `sandbox-${purchaseToken.slice(0, 32)}` };
  } else {
    verified = await verifyGooglePurchase(productId, purchaseToken);
  }
  if (!verified.ok) {
    console.warn(`[PurchaseCredits] Verification failed for ${userId}: ${verified.reason}`);
    return createErrorResponse(402, "Purchase could not be verified", { Reason: verified.reason });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await dynamoDBClient.send(
      new PutItemCommand({
        TableName: RECEIPT_TABLE,
        Item: marshall({
          PurchaseToken: `${platform}:${purchaseToken}`,
          PlayerID: userId,
          ProductId: productId,
          Credits: pack.Credits,
          OrderId: verified.orderId ?? "",
          CreatedAt: now
        }),
        ConditionExpression: "attribute_not_exists(PurchaseToken)"
      })
    );
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return createErrorResponse(409, "Purchase token already used", { Reason: "TokenReused" });
    }
    console.error("[PurchaseCredits] Receipt write error:", error);
    throw error;
  }
  const result = await dynamoDBClient.send(
    new UpdateItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      UpdateExpression: "SET Credits = if_not_exists(Credits, :zero) + :credits, UpdatedAt = :now",
      ExpressionAttributeValues: marshall({ ":zero": 0, ":credits": pack.Credits, ":now": now }),
      ReturnValues: "ALL_NEW"
    })
  );
  const state = readShopState(unmarshall(result.Attributes));
  console.log(`[PurchaseCredits] Player ${userId} +${pack.Credits} (${productId}, ${platform}) \u2192 ${state.Credits}`);
  return createSuccessResponse({
    ProductId: productId,
    GrantedCredits: pack.Credits,
    Credits: state.Credits,
    OrderId: verified.orderId ?? ""
  });
};
var handler = createIdempotentHandler(lambdaHandler, IdempotencyType.PAYMENT_VERIFY);
export {
  handler
};
