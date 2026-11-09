// purchaseOutfit.ts
import {
  IdempotencyType,
  validateIdempotencyKey,
  createErrorResponse,
  createSuccessResponse,
  createIdempotentHandler
} from "quiz-utils/idempotencyUtils";
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand2, UpdateItemCommand as UpdateItemCommand2 } from "@aws-sdk/client-dynamodb";
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
function findOutfit(outfitId) {
  return OUTFITS.find((o) => o.OutfitId === outfitId);
}
function isForSale(outfit) {
  return outfit.Source !== "Achievement" && outfit.Price > 0;
}
function isStoryLocked(outfit, hasUnlock2) {
  return outfit.Source === "Story" && !!outfit.Unlock && !hasUnlock2(outfit.Unlock);
}

// storyStore.ts
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
var PLAYER_TABLE = "PlayerResources";
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
async function readStoryRow(playerId) {
  const r = await client.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: playerId }),
      ProjectionExpression: "PlayerID, #story, AttendanceStreak, TotalAttendanceDays, OwnedOutfits",
      ExpressionAttributeNames: { "#story": "Story" }
    })
  );
  const row = r.Item ? unmarshall(r.Item) : {};
  const story = {};
  for (const [k, v] of Object.entries(row.Story ?? {})) story[k] = normalizeCharState(v);
  return { Story: story, Row: row };
}
async function readStory(playerId) {
  return (await readStoryRow(playerId)).Story;
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

// purchaseOutfit.ts
var dynamoDBClient = new DynamoDBClient2({ region: process.env.REGION });
var PLAYER_TABLE2 = "PlayerResources";
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
  if (!isForSale(outfit)) {
    return createErrorResponse(409, "Not for sale", { Reason: "NotForSale" });
  }
  if (outfit.Source === "Story") {
    const story = await readStory(userId);
    if (isStoryLocked(outfit, (id) => hasUnlock(story, id))) {
      return createErrorResponse(409, "Locked until the story unlocks it", { Reason: "StoryLocked" });
    }
  }
  const getResult = await dynamoDBClient.send(
    new GetItemCommand2({
      TableName: PLAYER_TABLE2,
      Key: marshall2({ PlayerID: userId }),
      ProjectionExpression: "Credits, OwnedOutfits"
    })
  );
  if (!getResult.Item) {
    return createErrorResponse(404, "Player not found");
  }
  const state = readShopState(unmarshall2(getResult.Item));
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
      new UpdateItemCommand2({
        TableName: PLAYER_TABLE2,
        Key: marshall2({ PlayerID: userId }),
        UpdateExpression: "SET Credits = Credits - :price, OwnedOutfits = list_append(if_not_exists(OwnedOutfits, :empty), :newItem), UpdatedAt = :now",
        ConditionExpression: "Credits >= :price AND (attribute_not_exists(OwnedOutfits) OR NOT contains(OwnedOutfits, :outfitId))",
        ExpressionAttributeValues: marshall2({
          ":price": outfit.Price,
          ":empty": [],
          ":newItem": [outfitId],
          ":outfitId": outfitId,
          ":now": now
        }),
        ReturnValues: "ALL_NEW"
      })
    );
    const updated = readShopState(unmarshall2(result.Attributes));
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
