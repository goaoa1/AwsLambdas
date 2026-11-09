// getShop.ts
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand2 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall2, unmarshall as unmarshall2 } from "@aws-sdk/util-dynamodb";

// shopCatalog.ts
var OUTFITS = [
  { OutfitId: "Outfit_Navy", Price: 300, Characters: ["Char_003", "Char_001"], Slot: "Set" },
  { OutfitId: "Outfit_WhiteBlouse", Price: 350, Characters: ["Char_003"], Slot: "Top", Source: "Story", Unlock: "shop_item_blouse" },
  // 서윤 10화에서 해금. 001 피팅은 아직 미완성
  { OutfitId: "Outfit_PlaidSkirt", Price: 300, Characters: ["Char_003"], Slot: "Bottom" },
  { OutfitId: "Outfit_Summer", Price: 450, Characters: ["Char_003"], Slot: "Set" },
  { OutfitId: "Outfit_Formal", Price: 800, Characters: [], Slot: "Set" },
  // 도전과제 '누적 정답' 4단계(5000개) 보상 (achievementCatalog.ts EXCLUSIVE_OUTFITS_READY 와 같이 바꾼다)
  { OutfitId: "Outfit_Exclusive_Scholar", Price: 0, Characters: ["Char_003"], Slot: "Set", Source: "Achievement" },
  // 액세서리 (사용자: 크레딧으로 사고, BC003 먼저, 어떤 옷과도 같이. 흰 블라우스의 원래 리본은 클라이언트가 숨긴다)
  { OutfitId: "Outfit_Acc_Ribbon", Price: 60, Characters: ["Char_003"], Slot: "Accessory" },
  { OutfitId: "Outfit_Acc_Necktie", Price: 80, Characters: ["Char_003"], Slot: "Accessory" }
];
var CREDIT_PACKS = [
  { ProductId: "credits_100", Credits: 100, BonusCredits: 0 },
  { ProductId: "credits_550", Credits: 550, BonusCredits: 50 },
  { ProductId: "credits_1200", Credits: 1200, BonusCredits: 200 }
];
function isStoryLocked(outfit, hasUnlock2) {
  return outfit.Source === "Story" && !!outfit.Unlock && !hasUnlock2(outfit.Unlock);
}

// storyStore.ts
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
var client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });
var strList = (v) => {
  if (Array.isArray(v)) return v.map(String);
  if (v instanceof Set) return [...v].map(String);
  return [];
};
function normalizeCharState(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const choices = {};
  if (r.Choices && typeof r.Choices === "object") for (const [k, v] of Object.entries(r.Choices)) choices[k] = String(v);
  return {
    Affinity: Math.max(0, Math.floor(Number(r.Affinity) || 0)),
    Seen: strList(r.Seen),
    Events: strList(r.Events),
    Flags: strList(r.Flags),
    Unlocked: strList(r.Unlocked),
    Claimed: strList(r.Claimed),
    Choices: choices,
    LastEpisodeDate: typeof r.LastEpisodeDate === "string" ? r.LastEpisodeDate : "",
    TapDate: typeof r.TapDate === "string" ? r.TapDate : "",
    TapPointsToday: Math.max(0, Math.floor(Number(r.TapPointsToday) || 0)),
    UpdatedAt: typeof r.UpdatedAt === "string" ? r.UpdatedAt : ""
  };
}
function hasUnlock(story, unlockId) {
  return Object.values(story).some((s) => s.Unlocked.includes(unlockId));
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

// getShop.ts
var dynamoDBClient = new DynamoDBClient2({ region: process.env.REGION });
var PLAYER_TABLE = "PlayerResources";
var handler = async (event, _context) => {
  console.log("[GetShop] Lambda invoked");
  const userId = event.requestContext?.authorizer?.claims?.sub;
  if (!userId) {
    return createErrorResponse(401, "Unauthorized");
  }
  const getResult = await dynamoDBClient.send(
    new GetItemCommand2({
      TableName: PLAYER_TABLE,
      Key: marshall2({ PlayerID: userId }),
      ProjectionExpression: "Credits, OwnedOutfits, EquippedOutfits, #story",
      ExpressionAttributeNames: { "#story": "Story" }
    })
  );
  const row = getResult.Item ? unmarshall2(getResult.Item) : void 0;
  const state = readShopState(row);
  const story = {};
  for (const [k, v] of Object.entries(row?.Story ?? {})) story[k] = normalizeCharState(v);
  const lockedOutfits = OUTFITS.filter((o) => isStoryLocked(o, (id) => hasUnlock(story, id))).map((o) => o.OutfitId);
  return createSuccessResponse({
    Credits: state.Credits,
    OwnedOutfits: state.OwnedOutfits,
    EquippedOutfits: state.EquippedOutfits,
    Outfits: OUTFITS,
    LockedOutfits: lockedOutfits,
    CreditPacks: CREDIT_PACKS,
    SandboxPurchaseAllowed: process.env.ALLOW_SANDBOX_PURCHASE === "true"
  });
};
export {
  handler
};
