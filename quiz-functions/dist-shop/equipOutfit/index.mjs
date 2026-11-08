// equipOutfit.ts
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

// shopCatalog.ts
var OUTFITS = [
  { OutfitId: "Outfit_Navy", Price: 300, Characters: ["Char_003", "Char_001"], Slot: "Set" },
  { OutfitId: "Outfit_WhiteBlouse", Price: 350, Characters: ["Char_003"], Slot: "Top" },
  // 001 피팅은 아직 미완성
  { OutfitId: "Outfit_PlaidSkirt", Price: 300, Characters: ["Char_003"], Slot: "Bottom" },
  { OutfitId: "Outfit_Summer", Price: 450, Characters: ["Char_003"], Slot: "Set" },
  { OutfitId: "Outfit_Formal", Price: 800, Characters: [], Slot: "Set" },
  // 도전과제 '누적 정답' 4단계(5000개) 보상 (achievementCatalog.ts EXCLUSIVE_OUTFITS_READY 와 같이 바꾼다)
  { OutfitId: "Outfit_Exclusive_Scholar", Price: 0, Characters: ["Char_003"], Slot: "Set", Source: "Achievement" },
  // 액세서리 (사용자: 크레딧으로 사고, BC003 먼저, 어떤 옷과도 같이. 흰 블라우스의 원래 리본은 클라이언트가 숨긴다)
  { OutfitId: "Outfit_Acc_Ribbon", Price: 60, Characters: ["Char_003"], Slot: "Accessory" },
  { OutfitId: "Outfit_Acc_Necktie", Price: 80, Characters: ["Char_003"], Slot: "Accessory" }
];
function splitEquipKey(key) {
  const i = key.indexOf("#");
  if (i < 0) return { characterId: key, slot: "" };
  const s = key.slice(i + 1);
  return { characterId: key.slice(0, i), slot: s === "Top" || s === "Bottom" || s === "Accessory" ? s : "Set" };
}
function slotOf(outfitId) {
  return findOutfit(outfitId)?.Slot ?? "Set";
}
function slotsOverlap(a, b) {
  if (a === "Accessory" || b === "Accessory") return a === b;
  return a === b || a === "Set" || b === "Set";
}
function equipInMap(map, characterId, outfitId) {
  const slot = slotOf(outfitId);
  const next = {};
  for (const [k, v] of Object.entries(map)) {
    const { characterId: c, slot: s } = splitEquipKey(k);
    if (c !== characterId) {
      next[k] = v;
      continue;
    }
    const existing = s === "" ? slotOf(v) : s;
    if (slotsOverlap(existing, slot)) continue;
    next[`${characterId}#${existing}`] = v;
  }
  next[`${characterId}#${slot}`] = outfitId;
  return next;
}
function unequipInMap(map, characterId, outfitId) {
  const next = {};
  for (const [k, v] of Object.entries(map)) {
    const { characterId: c } = splitEquipKey(k);
    if (c === characterId && (outfitId === "" || v === outfitId)) continue;
    next[k] = v;
  }
  return next;
}
function findOutfit(outfitId) {
  return OUTFITS.find((o) => o.OutfitId === outfitId);
}
function outfitFitsCharacter(outfit, characterId) {
  return outfit.Characters.length === 0 || outfit.Characters.includes(characterId);
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

// equipOutfit.ts
var dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
var PLAYER_TABLE = "PlayerResources";
var CHARACTER_ID_PATTERN = /^[A-Za-z0-9_]{1,32}$/;
var handler = async (event, _context) => {
  console.log("[EquipOutfit] Lambda invoked");
  const userId = event.requestContext?.authorizer?.claims?.sub;
  if (!userId) {
    return createErrorResponse(401, "Unauthorized");
  }
  let characterId;
  let outfitId;
  let unequip = false;
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    characterId = body.CharacterId;
    outfitId = body.OutfitId ?? "";
    unequip = body.Unequip === true;
  } catch {
    return createErrorResponse(400, "Invalid request body");
  }
  if (typeof characterId !== "string" || !CHARACTER_ID_PATTERN.test(characterId)) {
    return createErrorResponse(400, "CharacterId is required");
  }
  if (typeof outfitId !== "string") {
    return createErrorResponse(400, "OutfitId must be a string");
  }
  const isUnequip = unequip || outfitId.length === 0;
  if (!isUnequip) {
    const outfit = findOutfit(outfitId);
    if (!outfit) {
      return createErrorResponse(404, "Unknown outfit");
    }
    if (!outfitFitsCharacter(outfit, characterId)) {
      return createErrorResponse(400, "This character cannot wear that outfit", { Reason: "NotCompatible" });
    }
  }
  const getResult = await dynamoDBClient.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      ProjectionExpression: "OwnedOutfits, EquippedOutfits"
    })
  );
  const current = readShopState(getResult.Item ? unmarshall(getResult.Item) : void 0);
  if (!isUnequip && !current.OwnedOutfits.includes(outfitId)) {
    return createErrorResponse(403, "Outfit not owned", { Reason: "NotOwned" });
  }
  const next = isUnequip ? unequipInMap(current.EquippedOutfits, characterId, outfitId) : equipInMap(current.EquippedOutfits, characterId, outfitId);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const result = await dynamoDBClient.send(
    new UpdateItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      UpdateExpression: "SET EquippedOutfits = :map, UpdatedAt = :now",
      ...isUnequip ? {} : { ConditionExpression: "contains(OwnedOutfits, :oid)" },
      ExpressionAttributeValues: marshall(
        isUnequip ? { ":map": next, ":now": now } : { ":map": next, ":now": now, ":oid": outfitId },
        { removeUndefinedValues: true }
      ),
      ReturnValues: "ALL_NEW"
    })
  );
  const state = readShopState(unmarshall(result.Attributes));
  console.log(`[EquipOutfit] Player ${userId} ${isUnequip ? "unequipped" : "equipped"} ${outfitId || "(all)"} on ${characterId}`);
  return createSuccessResponse({
    CharacterId: characterId,
    OutfitId: isUnequip ? "" : outfitId,
    EquippedOutfits: state.EquippedOutfits
  });
};
export {
  handler
};
