// getShop.ts
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
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
var CREDIT_PACKS = [
  { ProductId: "credits_100", Credits: 100, BonusCredits: 0 },
  { ProductId: "credits_550", Credits: 550, BonusCredits: 50 },
  { ProductId: "credits_1200", Credits: 1200, BonusCredits: 200 }
];

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

// getShop.ts
var dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
var PLAYER_TABLE = "PlayerResources";
var handler = async (event, _context) => {
  console.log("[GetShop] Lambda invoked");
  const userId = event.requestContext?.authorizer?.claims?.sub;
  if (!userId) {
    return createErrorResponse(401, "Unauthorized");
  }
  const getResult = await dynamoDBClient.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      ProjectionExpression: "Credits, OwnedOutfits, EquippedOutfits"
    })
  );
  const state = readShopState(getResult.Item ? unmarshall(getResult.Item) : void 0);
  return createSuccessResponse({
    Credits: state.Credits,
    OwnedOutfits: state.OwnedOutfits,
    EquippedOutfits: state.EquippedOutfits,
    Outfits: OUTFITS,
    CreditPacks: CREDIT_PACKS,
    SandboxPurchaseAllowed: process.env.ALLOW_SANDBOX_PURCHASE === "true"
  });
};
export {
  handler
};
