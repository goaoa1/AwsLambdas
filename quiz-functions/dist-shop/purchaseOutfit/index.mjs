// purchaseOutfit.ts
import {
  IdempotencyType,
  validateIdempotencyKey,
  createErrorResponse,
  createSuccessResponse,
  createIdempotentHandler
} from "quiz-utils/idempotencyUtils";
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

// shopCatalog.ts
var OUTFITS = [
  { OutfitId: "Outfit_Navy", Price: 300, Characters: ["Char_003", "Char_001"], Slot: "Set" },
  { OutfitId: "Outfit_WhiteBlouse", Price: 350, Characters: ["Char_003"], Slot: "Top" },
  // 001 피팅은 아직 미완성
  { OutfitId: "Outfit_PlaidSkirt", Price: 300, Characters: ["Char_003"], Slot: "Bottom" },
  { OutfitId: "Outfit_Summer", Price: 450, Characters: ["Char_003"], Slot: "Set" },
  { OutfitId: "Outfit_Formal", Price: 800, Characters: [], Slot: "Set" }
];
function findOutfit(outfitId) {
  return OUTFITS.find((o) => o.OutfitId === outfitId);
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

// purchaseOutfit.ts
var dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
var PLAYER_TABLE = "PlayerResources";
var lambdaHandler = async (event, _context) => {
  console.log("[PurchaseOutfit] Lambda invoked");
  const validation = validateIdempotencyKey(event, IdempotencyType.ITEM_PURCHASE);
  if (!validation.isValid) {
    return createErrorResponse(400, validation.error);
  }
  const userId = validation.userId;
  let outfitId;
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    outfitId = body.OutfitId;
  } catch {
    return createErrorResponse(400, "Invalid request body");
  }
  if (!outfitId || typeof outfitId !== "string") {
    return createErrorResponse(400, "OutfitId is required");
  }
  const outfit = findOutfit(outfitId);
  if (!outfit) {
    return createErrorResponse(404, "Unknown outfit");
  }
  const getResult = await dynamoDBClient.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      ProjectionExpression: "Credits, OwnedOutfits"
    })
  );
  if (!getResult.Item) {
    return createErrorResponse(404, "Player not found");
  }
  const state = readShopState(unmarshall(getResult.Item));
  if (state.OwnedOutfits.includes(outfitId)) {
    return createErrorResponse(409, "Already owned", { Reason: "AlreadyOwned", Credits: state.Credits });
  }
  if (state.Credits < outfit.Price) {
    return createErrorResponse(409, "Insufficient credits", {
      Reason: "InsufficientCredits",
      Credits: state.Credits,
      Price: outfit.Price
    });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const result = await dynamoDBClient.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: userId }),
        UpdateExpression: "SET Credits = Credits - :price, OwnedOutfits = list_append(if_not_exists(OwnedOutfits, :empty), :newItem), UpdatedAt = :now",
        ConditionExpression: "Credits >= :price AND (attribute_not_exists(OwnedOutfits) OR NOT contains(OwnedOutfits, :outfitId))",
        ExpressionAttributeValues: marshall({
          ":price": outfit.Price,
          ":empty": [],
          ":newItem": [outfitId],
          ":outfitId": outfitId,
          ":now": now
        }),
        ReturnValues: "ALL_NEW"
      })
    );
    const updated = readShopState(unmarshall(result.Attributes));
    console.log(`[PurchaseOutfit] Player ${userId} bought ${outfitId} for ${outfit.Price}. Credits ${state.Credits} -> ${updated.Credits}`);
    return createSuccessResponse({
      OutfitId: outfitId,
      Price: outfit.Price,
      Credits: updated.Credits,
      OwnedOutfits: updated.OwnedOutfits
    });
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return createErrorResponse(409, "Purchase rejected", { Reason: "Conflict" });
    }
    console.error("[PurchaseOutfit] Update error:", error);
    throw error;
  }
};
var handler = createIdempotentHandler(lambdaHandler, IdempotencyType.ITEM_PURCHASE);
export {
  handler
};
