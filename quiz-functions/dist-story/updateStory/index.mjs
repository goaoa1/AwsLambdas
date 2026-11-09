// updateStory.ts
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
async function readStory(playerId) {
  return (await readStoryRow(playerId)).Story;
}
var union = (a, b) => [.../* @__PURE__ */ new Set([...a, ...b])];
function mergeCharState(cur, patch) {
  const next = { ...cur };
  if (patch.Affinity !== void 0) next.Affinity = Math.max(cur.Affinity, Math.floor(Number(patch.Affinity) || 0));
  if (patch.Seen) next.Seen = union(cur.Seen, strList(patch.Seen));
  if (patch.Events) next.Events = union(cur.Events, strList(patch.Events));
  if (patch.Flags) next.Flags = union(cur.Flags, strList(patch.Flags));
  if (patch.Unlocked) next.Unlocked = union(cur.Unlocked, strList(patch.Unlocked));
  if (patch.Claimed) next.Claimed = union(cur.Claimed, strList(patch.Claimed));
  if (patch.Choices) next.Choices = { ...cur.Choices, ...patch.Choices };
  if (patch.LastEpisodeDate && patch.LastEpisodeDate > cur.LastEpisodeDate) next.LastEpisodeDate = patch.LastEpisodeDate;
  if (patch.TapDate) {
    if (patch.TapDate > cur.TapDate) {
      next.TapDate = patch.TapDate;
      next.TapPointsToday = Math.max(0, Number(patch.TapPointsToday) || 0);
    } else if (patch.TapDate === cur.TapDate) next.TapPointsToday = Math.max(cur.TapPointsToday, Number(patch.TapPointsToday) || 0);
  }
  next.UpdatedAt = (/* @__PURE__ */ new Date()).toISOString();
  return next;
}
async function ensureStoryMap(playerId) {
  try {
    await client.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall3({ PlayerID: playerId }),
        UpdateExpression: "SET #story = if_not_exists(#story, :empty)",
        ConditionExpression: "attribute_exists(PlayerID)",
        ExpressionAttributeNames: { "#story": "Story" },
        ExpressionAttributeValues: marshall3({ ":empty": {} })
      })
    );
  } catch (e) {
    if (e.name !== "ConditionalCheckFailedException") throw e;
  }
}
async function writeCharState(playerId, characterId, state) {
  await ensureStoryMap(playerId);
  await client.send(
    new UpdateItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall3({ PlayerID: playerId }),
      UpdateExpression: "SET #story.#c = :s, UpdatedAt = :now",
      ConditionExpression: "attribute_exists(PlayerID)",
      ExpressionAttributeNames: { "#story": "Story", "#c": characterId },
      ExpressionAttributeValues: marshall3({ ":s": state, ":now": (/* @__PURE__ */ new Date()).toISOString() }, { removeUndefinedValues: true })
    })
  );
}

// updateStory.ts
var MAX_LIST = 200;
var cleanList = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length <= 64).slice(0, MAX_LIST) : void 0;
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  const body = parseBody(event.body);
  const characterId = typeof body?.CharacterId === "string" ? body.CharacterId : "";
  if (!body || !CHARACTER_IDS.has(characterId)) return createErrorResponse(400, "Unknown character", { Reason: "UnknownCharacter" });
  const patch = {};
  if (body.Affinity !== void 0) patch.Affinity = Math.min(1e5, Math.max(0, Math.floor(Number(body.Affinity) || 0)));
  const seen = cleanList(body.Seen);
  if (seen) patch.Seen = seen;
  const events = cleanList(body.Events);
  if (events) patch.Events = events;
  const flags = cleanList(body.Flags);
  if (flags) patch.Flags = flags;
  const unlocked = cleanList(body.Unlocked);
  if (unlocked) patch.Unlocked = unlocked;
  if (body.Choices && typeof body.Choices === "object") {
    patch.Choices = {};
    for (const [k, v] of Object.entries(body.Choices).slice(0, 50)) if (typeof v === "string") patch.Choices[k] = v.slice(0, 32);
  }
  if (typeof body.LastEpisodeDate === "string") patch.LastEpisodeDate = body.LastEpisodeDate.slice(0, 10);
  if (typeof body.TapDate === "string") {
    patch.TapDate = body.TapDate.slice(0, 10);
    patch.TapPointsToday = Math.max(0, Math.floor(Number(body.TapPointsToday) || 0));
  }
  try {
    const story = await readStory(me);
    const merged = mergeCharState(story[characterId] ?? emptyCharState(), patch);
    await writeCharState(me, characterId, merged);
    console.log(`[UpdateStory] ${me} ${characterId} affinity=${merged.Affinity} seen=${merged.Seen.length} flags=${merged.Flags.length}`);
    return createSuccessResponse({ CharacterId: characterId, Story: merged });
  } catch (e) {
    console.error("[UpdateStory] error", e);
    return createErrorResponse(500, "Story error", { Reason: "ServerError" });
  }
};
export {
  handler
};
