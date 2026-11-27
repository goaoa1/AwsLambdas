// equipGear.ts
import { DynamoDBClient as DynamoDBClient3, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall4 } from "@aws-sdk/util-dynamodb";
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";

// friendStore.ts
import { BatchGetItemCommand, GetItemCommand as GetItemCommand2, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall2, unmarshall as unmarshall2 } from "@aws-sdk/util-dynamodb";

// profileStore.ts
import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
var dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });

// friendStore.ts
function getUserId(event) {
  return event.requestContext?.authorizer?.claims?.sub;
}
function parseBody(body) {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return void 0;
  }
}

// gearCatalog.ts
var CHARACTERS = ["Player", "Char_001", "Char_002", "Char_003", "Char_004"];
var SLOTS = ["Weapon", "Armor", "Accessory"];
var MAX_GEAR_COUNT = 5;
var BOOK_ID = "Book_Skill";
var MAX_SKILL_LEVEL = 5;
var BOOKS_TO_LEVEL = [0, 0, 1, 2, 3, 4];
var SKILL_IDS = ["blast", "chain", "lance", "barrage", "meteor", "frost"];
var MAX_SKILLS = 3;
var DEFAULT_SKILLS = {
  Player: ["blast", "chain", "frost"],
  Char_001: ["barrage", "lance", "chain"],
  Char_002: ["meteor", "blast", "frost"],
  Char_003: ["blast", "lance", "barrage"],
  Char_004: ["chain", "frost", "lance"]
};
var GEAR = [
  { ItemId: "Gear_W_Branch", Slot: "Weapon", Rarity: "Common", Name: "\uB098\uBB47\uAC00\uC9C0 \uC9C0\uD321\uC774", Desc: "\uC8FC\uBB38 \uC704\uB825 +10%", Stats: { Power: 0.1 }, Price: 120, Level: 0 },
  { ItemId: "Gear_W_Oak", Slot: "Weapon", Rarity: "Rare", Name: "\uCC38\uB098\uBB34 \uC9C0\uD321\uC774", Desc: "\uC8FC\uBB38 \uC704\uB825 +20%", Stats: { Power: 0.2 }, Price: 300, Level: 0 },
  { ItemId: "Gear_W_Star", Slot: "Weapon", Rarity: "Epic", Name: "\uBCC4\uBE5B \uC9C0\uD321\uC774", Desc: "\uC8FC\uBB38 \uC704\uB825 +35%", Stats: { Power: 0.35 }, Price: 0, Level: 0 },
  { ItemId: "Gear_A_Cloak", Slot: "Armor", Rarity: "Common", Name: "\uB204\uBE48 \uB9DD\uD1A0", Desc: "\uCCB4\uB825 +20", Stats: { Hp: 20 }, Price: 100, Level: 0 },
  { ItemId: "Gear_A_Robe", Slot: "Armor", Rarity: "Rare", Name: "\uACAC\uC2B5\uC0DD \uB85C\uBE0C", Desc: "\uCCB4\uB825 +35, \uBC1B\uB294 \uD53C\uD574 \u221210%", Stats: { Hp: 35, Guard: 0.1 }, Price: 280, Level: 0 },
  { ItemId: "Gear_A_Silver", Slot: "Armor", Rarity: "Epic", Name: "\uC740\uC2E4 \uB85C\uBE0C", Desc: "\uCCB4\uB825 +50, \uBC1B\uB294 \uD53C\uD574 \u221220%", Stats: { Hp: 50, Guard: 0.2 }, Price: 0, Level: 0 },
  { ItemId: "Gear_C_Bell", Slot: "Accessory", Rarity: "Common", Name: "\uBC15\uC790 \uBC29\uC6B8", Desc: "\uC554\uC1A1 \uC2DC\uAC04 +0.5\uCD08", Stats: { Recite: 0.5 }, Price: 150, Level: 0 },
  { ItemId: "Gear_C_Ring", Slot: "Accessory", Rarity: "Rare", Name: "\uB9C8\uB825 \uBC18\uC9C0", Desc: "\uB9C8\uB825 +25%", Stats: { Mana: 0.25 }, Price: 260, Level: 0 },
  { ItemId: "Gear_C_Pendant", Slot: "Accessory", Rarity: "Epic", Name: "\uACF5\uBA85 \uBAA9\uAC78\uC774", Desc: "\uACF5\uBA85\uC774 30% \uBE68\uB9AC \uCC2C\uB2E4", Stats: { Resonance: 0.3 }, Price: 0, Level: 0 }
];
function findGear(id) {
  return id ? GEAR.find((g) => g.ItemId === id) : void 0;
}
function isCharacter(id) {
  return typeof id === "string" && CHARACTERS.includes(id);
}
function isSkillId(id) {
  return typeof id === "string" && SKILL_IDS.includes(id);
}
function isSlot(s) {
  return typeof s === "string" && SLOTS.includes(s);
}
var gearKey = (characterId, slot) => `${characterId}#${slot}`;

// gearStore.ts
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand3 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall3, unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";
var PLAYER_TABLE = "PlayerResources";
var client = new DynamoDBClient2({ region: process.env.REGION || process.env.AWS_REGION });
async function readPlayerGear(playerId) {
  const r = await client.send(
    new GetItemCommand3({
      TableName: PLAYER_TABLE,
      Key: marshall3({ PlayerID: playerId }),
      ProjectionExpression: "PlayerID, #items, Credits, EquippedGear, SkillLevels, SkillLoadout, GearRev",
      ExpressionAttributeNames: { "#items": "Items" },
      // Items 는 DynamoDB 예약어
      ConsistentRead: true
    })
  );
  const p = r.Item ? unmarshall3(r.Item) : {};
  const items = {};
  for (const [k, v] of Object.entries(p.Items ?? {})) items[k] = Number(v) || 0;
  const equipped = {};
  for (const [k, v] of Object.entries(p.EquippedGear ?? {})) if (typeof v === "string" && v) equipped[k] = v;
  const levels = {};
  for (const [k, v] of Object.entries(p.SkillLevels ?? {})) levels[k] = Math.max(1, Math.min(MAX_SKILL_LEVEL, Number(v) || 1));
  const loadout = {};
  for (const [k, v] of Object.entries(p.SkillLoadout ?? {})) {
    if (Array.isArray(v)) loadout[k] = [...new Set(v.map((x) => String(x)).filter(isSkillId))].slice(0, MAX_SKILLS);
  }
  return {
    Exists: !!r.Item,
    Items: items,
    Credits: Number(p.Credits) || 0,
    Equipped: equipped,
    bHasEquipped: p.EquippedGear !== void 0,
    SkillLevels: levels,
    bHasSkillLevels: p.SkillLevels !== void 0,
    SkillLoadout: loadout,
    Rev: p.GearRev === void 0 ? void 0 : Number(p.GearRev) || 0
  };
}
function wearingCount(equipped, itemId, exceptKey) {
  let n = 0;
  for (const [k, v] of Object.entries(equipped)) if (v === itemId && k !== exceptKey) n++;
  return n;
}
function revGuard(row) {
  return row.Rev === void 0 ? { cond: "attribute_not_exists(GearRev)", values: { ":rev1": 1 } } : { cond: "GearRev = :rev", values: { ":rev": row.Rev, ":rev1": row.Rev + 1 } };
}
function toClientGear(row) {
  const equipped = {};
  for (const c of CHARACTERS) {
    const slots = {};
    for (const s of SLOTS) slots[s] = row.Equipped[`${c}#${s}`] ?? "";
    equipped[c] = slots;
  }
  const levels = {};
  for (const c of CHARACTERS) levels[c] = row.SkillLevels[c] ?? 1;
  const loadout = {};
  for (const c of CHARACTERS) loadout[c] = row.SkillLoadout[c] ?? DEFAULT_SKILLS[c] ?? [];
  return {
    Gear: GEAR.map((g) => ({
      ItemId: g.ItemId,
      Slot: g.Slot,
      Rarity: g.Rarity,
      Name: g.Name,
      Desc: g.Desc,
      Stats: g.Stats,
      Price: g.Price,
      Level: g.Level,
      Count: row.Items[g.ItemId] ?? 0,
      Wearing: wearingCount(row.Equipped, g.ItemId)
    })),
    Equipped: equipped,
    SkillLevels: levels,
    Books: row.Items[BOOK_ID] ?? 0,
    BookId: BOOK_ID,
    BooksToLevel: BOOKS_TO_LEVEL,
    MaxSkillLevel: MAX_SKILL_LEVEL,
    MaxGearCount: MAX_GEAR_COUNT,
    SkillLoadout: loadout,
    MaxSkills: MAX_SKILLS,
    SkillIds: SKILL_IDS,
    Credits: row.Credits
  };
}

// equipGear.ts
var client2 = new DynamoDBClient3({ region: process.env.REGION });
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  const body = parseBody(event.body);
  const characterId = body?.CharacterId;
  const slot = body?.Slot;
  if (!isCharacter(characterId)) return createErrorResponse(400, "Bad character", { Reason: "BadCharacter" });
  const skills = body?.Skills;
  if (Array.isArray(skills)) return equipSkills(me, characterId, skills);
  if (!isSlot(slot)) return createErrorResponse(400, "Bad slot", { Reason: "BadSlot" });
  const itemId = String(body?.ItemId ?? "").trim();
  const key = gearKey(characterId, slot);
  try {
    const row = await readPlayerGear(me);
    if (!row.Exists) return createErrorResponse(404, "Player not found", { Reason: "NoPlayer" });
    const next = { ...row.Equipped };
    if (itemId) {
      const gear = findGear(itemId);
      if (!gear) return createErrorResponse(400, "Unknown item", { Reason: "UnknownItem" });
      if (gear.Slot !== slot) return createErrorResponse(400, "Wrong slot", { Reason: "WrongSlot" });
      const owned = row.Items[itemId] ?? 0;
      if (owned < 1) return createErrorResponse(409, "Not owned", { Reason: "NotOwned" });
      if (wearingCount(row.Equipped, itemId, key) >= owned) return createErrorResponse(409, "All in use", { Reason: "AllInUse" });
      next[key] = itemId;
    } else {
      delete next[key];
    }
    if ((next[key] ?? "") !== (row.Equipped[key] ?? "")) {
      const g = revGuard(row);
      try {
        await client2.send(
          new UpdateItemCommand({
            TableName: PLAYER_TABLE,
            Key: marshall4({ PlayerID: me }),
            UpdateExpression: "SET EquippedGear = :eq, GearRev = :rev1, UpdatedAt = :now",
            ConditionExpression: `attribute_exists(PlayerID) AND ${g.cond}`,
            ExpressionAttributeValues: marshall4({ ":eq": next, ":now": (/* @__PURE__ */ new Date()).toISOString(), ...g.values })
          })
        );
      } catch (e) {
        if (e.name === "ConditionalCheckFailedException") return createErrorResponse(409, "Try again", { Reason: "Conflict" });
        throw e;
      }
      console.log(`[EquipGear] ${me} ${key} ${row.Equipped[key] ?? "-"} -> ${next[key] ?? "-"}`);
    }
    return createSuccessResponse({ Equip: { CharacterId: characterId, Slot: slot, ItemId: next[key] ?? "" }, ...toClientGear(await readPlayerGear(me)) });
  } catch (e) {
    console.error("[EquipGear]", e);
    return createErrorResponse(500, "Failed to equip");
  }
};
async function equipSkills(me, characterId, raw) {
  const ids = [...new Set(raw.map((v) => String(v ?? "").trim()).filter((v) => v))];
  if (ids.length > MAX_SKILLS) return createErrorResponse(400, "Too many skills", { Reason: "TooManySkills" });
  if (ids.some((id) => !isSkillId(id))) return createErrorResponse(400, "Unknown skill", { Reason: "UnknownSkill" });
  try {
    const row = await readPlayerGear(me);
    if (!row.Exists) return createErrorResponse(404, "Player not found", { Reason: "NoPlayer" });
    const before = row.SkillLoadout[characterId];
    if (!before || before.join(",") !== ids.join(",")) {
      const next = { ...row.SkillLoadout, [characterId]: ids };
      const g = revGuard(row);
      try {
        await client2.send(
          new UpdateItemCommand({
            TableName: PLAYER_TABLE,
            Key: marshall4({ PlayerID: me }),
            UpdateExpression: "SET SkillLoadout = :lo, GearRev = :rev1, UpdatedAt = :now",
            ConditionExpression: `attribute_exists(PlayerID) AND ${g.cond}`,
            ExpressionAttributeValues: marshall4({ ":lo": next, ":now": (/* @__PURE__ */ new Date()).toISOString(), ...g.values })
          })
        );
      } catch (e) {
        if (e.name === "ConditionalCheckFailedException") return createErrorResponse(409, "Try again", { Reason: "Conflict" });
        throw e;
      }
      console.log(`[EquipGear] ${me} skills ${characterId} ${before ? before.join(",") : "(default)"} -> ${ids.join(",") || "(none)"}`);
    }
    return createSuccessResponse({ SkillsSet: { CharacterId: characterId, Skills: ids }, ...toClientGear(await readPlayerGear(me)) });
  } catch (e) {
    console.error("[EquipGear] skills", e);
    return createErrorResponse(500, "Failed to set skills");
  }
}
export {
  handler
};
