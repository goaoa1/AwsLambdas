// claimStoryUnlock.ts
import { DynamoDBClient as DynamoDBClient4, UpdateItemCommand as UpdateItemCommand3 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall5 } from "@aws-sdk/util-dynamodb";
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

// storyStore.ts
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand3, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall3, unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";
var PLAYER_TABLE = "PlayerResources";
var client = new DynamoDBClient2({ region: process.env.REGION || process.env.AWS_REGION });
var CHARACTER_IDS = /* @__PURE__ */ new Set(["Char_001", "Char_002", "Char_003"]);
function emptyCharState() {
  return { Affinity: 0, Seen: [], Events: [], Flags: [], Unlocked: [], Claimed: [], Choices: {}, LastEpisodeDate: "", TapDate: "", TapPointsToday: 0, UpdatedAt: "" };
}
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
    new GetItemCommand3({
      TableName: PLAYER_TABLE,
      Key: marshall3({ PlayerID: playerId }),
      ProjectionExpression: "PlayerID, #story, AttendanceStreak, TotalAttendanceDays, OwnedOutfits",
      ExpressionAttributeNames: { "#story": "Story" }
    })
  );
  const row = r.Item ? unmarshall3(r.Item) : {};
  const story = {};
  for (const [k, v] of Object.entries(row.Story ?? {})) story[k] = normalizeCharState(v);
  return { Story: story, Row: row };
}

// storyCatalog.ts
var STORY_REWARDS = {
  potion_reaction: { Items: { Item_StaminaS: 1 } },
  // 서윤 8화 '매점': 작은 물약 1개
  tie_reward: { Outfit: "Outfit_Acc_Necktie" }
  // 서윤 15화 '만점': 부장 넥타이
};
function findStoryReward(unlockId) {
  return unlockId ? STORY_REWARDS[unlockId] : void 0;
}

// inventoryStore.ts
import { DynamoDBClient as DynamoDBClient3, GetItemCommand as GetItemCommand4, UpdateItemCommand as UpdateItemCommand2 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall4, unmarshall as unmarshall4 } from "@aws-sdk/util-dynamodb";

// itemCatalog.ts
var MAX_ITEM_COUNT = 99;
var ITEMS = [
  { ItemId: "Item_StaminaS", Name: "\uC791\uC740 \uBB3C\uC57D", Desc: "\uC2A4\uD0DC\uBBF8\uB098 +1", Stamina: 1, Price: 30 },
  { ItemId: "Item_StaminaL", Name: "\uD070 \uBB3C\uC57D", Desc: "\uC2A4\uD0DC\uBBF8\uB098 +3", Stamina: 3, Price: 80 },
  { ItemId: "Item_StaminaFull", Name: "\uAC00\uB4DD \uCC44\uC6B0\uAE30", Desc: "\uC2A4\uD0DC\uBBF8\uB098\uB97C 10\uAE4C\uC9C0", Stamina: "Full", Price: 200 }
];
function findItem(id) {
  return id ? ITEMS.find((i) => i.ItemId === id) : void 0;
}
var ITEM_NAME = (id) => findItem(id)?.Name ?? id;

// giftRules.ts
var MAX_STAMINA = 10;
var REGEN_INTERVAL_MS = 10 * 60 * 1e3;
function effectiveStamina(stored, lastUpdateAt, nowMs = Date.now()) {
  if (stored >= MAX_STAMINA || lastUpdateAt == null) return { stamina: Math.min(stored, MAX_STAMINA), clock: lastUpdateAt };
  const regen = Math.floor((nowMs - lastUpdateAt) / REGEN_INTERVAL_MS);
  if (regen <= 0) return { stamina: stored, clock: lastUpdateAt };
  const stamina = Math.min(stored + regen, MAX_STAMINA);
  return { stamina, clock: stamina >= MAX_STAMINA ? void 0 : lastUpdateAt + regen * REGEN_INTERVAL_MS };
}

// inventoryStore.ts
var PLAYER_TABLE2 = "PlayerResources";
var client2 = new DynamoDBClient3({ region: process.env.REGION || process.env.AWS_REGION });
async function readPlayerItems(playerId, nowMs = Date.now()) {
  const r = await client2.send(
    new GetItemCommand4({
      TableName: PLAYER_TABLE2,
      Key: marshall4({ PlayerID: playerId }),
      ProjectionExpression: "PlayerID, #items, Credits, Stamina, LastStaminaUpdateAt",
      ExpressionAttributeNames: { "#items": "Items" }
      // Items 는 DynamoDB 예약어
    })
  );
  const p = r.Item ? unmarshall4(r.Item) : {};
  const stored = Number(p.Stamina) || 0;
  const eff = effectiveStamina(stored, p.LastStaminaUpdateAt, nowMs);
  const items = {};
  for (const [k, v] of Object.entries(p.Items ?? {})) items[k] = Number(v) || 0;
  return { Items: items, Credits: Number(p.Credits) || 0, StoredStamina: stored, Stamina: eff.stamina, Clock: eff.clock, Exists: !!r.Item };
}
async function ensureItemsMap(playerId) {
  try {
    await client2.send(
      new UpdateItemCommand2({
        TableName: PLAYER_TABLE2,
        Key: marshall4({ PlayerID: playerId }),
        UpdateExpression: "SET #items = if_not_exists(#items, :empty)",
        ConditionExpression: "attribute_exists(PlayerID)",
        ExpressionAttributeNames: { "#items": "Items" },
        ExpressionAttributeValues: marshall4({ ":empty": {} })
      })
    );
  } catch (e) {
    if (e.name !== "ConditionalCheckFailedException") throw e;
  }
}
function grantItemsExpression(grants, current, prefix = "g") {
  const sets = [];
  const conds = [];
  const names = { "#items": "Items" };
  const values = {};
  const granted = {};
  let i = 0;
  for (const [itemId, n] of Object.entries(grants)) {
    if (!n || n <= 0) continue;
    const cur = current[itemId] ?? 0;
    const next = Math.min(MAX_ITEM_COUNT, cur + n);
    granted[itemId] = next - cur;
    names[`#${prefix}${i}`] = itemId;
    values[`:${prefix}${i}`] = next;
    sets.push(`#items.#${prefix}${i} = :${prefix}${i}`);
    values[`:${prefix}c${i}`] = cur;
    conds.push(`(attribute_not_exists(#items.#${prefix}${i}) OR #items.#${prefix}${i} = :${prefix}c${i})`);
    i++;
  }
  if (!sets.length) delete names["#items"];
  return { sets, conds, names, values, granted };
}

// claimStoryUnlock.ts
var client3 = new DynamoDBClient4({ region: process.env.REGION });
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  const body = parseBody(event.body);
  const characterId = body?.CharacterId ?? "";
  const unlockId = body?.UnlockId ?? "";
  if (!CHARACTER_IDS.has(characterId)) return createErrorResponse(400, "Unknown character", { Reason: "UnknownCharacter" });
  const reward = findStoryReward(unlockId);
  if (!reward) return createErrorResponse(400, "No reward for this unlock", { Reason: "UnknownUnlock" });
  try {
    const { Story, Row } = await readStoryRow(me);
    const state = Story[characterId] ?? emptyCharState();
    if (!state.Unlocked.includes(unlockId)) return createErrorResponse(409, "Not unlocked yet", { Reason: "NotUnlocked" });
    if (state.Claimed.includes(unlockId)) return createErrorResponse(409, "Already claimed", { Reason: "AlreadyClaimed" });
    const sets = ["#story.#c.#cl = list_append(if_not_exists(#story.#c.#cl, :emptyList), :claim)", "UpdatedAt = :now"];
    const conds = ["attribute_exists(#story.#c)", "(attribute_not_exists(#story.#c.#cl) OR NOT contains(#story.#c.#cl, :unlockId))"];
    const names = { "#story": "Story", "#c": characterId, "#cl": "Claimed" };
    const values = { ":emptyList": [], ":claim": [unlockId], ":unlockId": unlockId, ":now": (/* @__PURE__ */ new Date()).toISOString() };
    let itemsGranted = {};
    if (reward.Items && Object.values(reward.Items).some((n) => n > 0)) {
      await ensureItemsMap(me);
      const cur = (await readPlayerItems(me)).Items;
      const g = grantItemsExpression(reward.Items, cur, "i");
      sets.push(...g.sets);
      conds.push(...g.conds);
      Object.assign(names, g.names);
      Object.assign(values, g.values);
      itemsGranted = g.granted;
    }
    let outfitGranted = "";
    if (reward.Outfit) {
      const owned = Row.OwnedOutfits ?? [];
      if (!owned.includes(reward.Outfit)) {
        sets.push("OwnedOutfits = list_append(if_not_exists(OwnedOutfits, :emptyList), :newOutfit)");
        conds.push("(attribute_not_exists(OwnedOutfits) OR NOT contains(OwnedOutfits, :outfitId))");
        values[":newOutfit"] = [reward.Outfit];
        values[":outfitId"] = reward.Outfit;
        outfitGranted = reward.Outfit;
      }
    }
    if (reward.Credits && reward.Credits > 0) {
      sets.push("Credits = if_not_exists(Credits, :zero) + :credits");
      values[":credits"] = reward.Credits;
      values[":zero"] = 0;
    }
    try {
      await client3.send(
        new UpdateItemCommand3({
          TableName: PLAYER_TABLE,
          Key: marshall5({ PlayerID: me }),
          UpdateExpression: `SET ${sets.join(", ")}`,
          ConditionExpression: conds.join(" AND "),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: marshall5(values)
        })
      );
    } catch (e) {
      if (e.name === "ConditionalCheckFailedException") {
        return createErrorResponse(409, "Already claimed or changed", { Reason: "Conflict" });
      }
      throw e;
    }
    const granted = Object.entries(itemsGranted).filter(([, n]) => n > 0).map(([id, n]) => `${ITEM_NAME(id)} \xD7${n}`);
    if (outfitGranted) granted.push(outfitGranted);
    if (reward.Credits) granted.push(`${reward.Credits} \uD06C\uB808\uB527`);
    console.log(`[ClaimStoryUnlock] ${me} ${characterId} ${unlockId}: ${granted.join(", ")}`);
    return createSuccessResponse({ CharacterId: characterId, UnlockId: unlockId, Items: itemsGranted, Outfit: outfitGranted, Credits: reward.Credits ?? 0, Text: granted.join(", ") });
  } catch (e) {
    console.error("[ClaimStoryUnlock] error", e);
    return createErrorResponse(500, "Story error", { Reason: "ServerError" });
  }
};
export {
  handler
};
