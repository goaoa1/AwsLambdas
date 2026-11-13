// updateDuel.ts
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

// duelStore.ts
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand3, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall3, unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";
var PLAYER_TABLE = "PlayerResources";
var client = new DynamoDBClient2({ region: process.env.REGION || process.env.AWS_REGION });
var OPPONENTS = /* @__PURE__ */ new Set(["Char_001", "Char_002", "Char_003"]);
var MAX_HISTORY = 60;
var MAX_RECENT = 4;
var isTable = (t) => Number.isInteger(t) && t >= 11 && t <= 19;
var cleanAt = (v) => typeof v === "string" ? v.slice(0, 40) : "";
function normalizeDuel(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const won = (Array.isArray(r.Won) ? r.Won : r.Won instanceof Set ? [...r.Won] : []).map(String).filter((w) => {
    const [opp, t] = w.split(":");
    return OPPONENTS.has(opp) && isTable(Number(t));
  });
  const history = [];
  for (const h of Array.isArray(r.History) ? r.History : []) {
    const o = h && typeof h === "object" ? h : {};
    const row = {
      Opponent: String(o.Opponent ?? ""),
      Table: Number(o.Table),
      Mine: Math.max(0, Math.min(19, Math.floor(Number(o.Mine) || 0))),
      Theirs: Math.max(0, Math.min(19, Math.floor(Number(o.Theirs) || 0))),
      Date: typeof o.Date === "string" ? o.Date.slice(0, 10) : "",
      At: cleanAt(o.At)
    };
    if (OPPONENTS.has(row.Opponent) && isTable(row.Table) && row.At) history.push(row);
  }
  const recent = {};
  if (r.Recent && typeof r.Recent === "object") {
    for (const [k, v] of Object.entries(r.Recent)) {
      if (!isTable(Number(k)) || !Array.isArray(v)) continue;
      const list = [];
      for (const e of v) {
        const o = e && typeof e === "object" ? e : {};
        const a = Number(o.A);
        const at = cleanAt(o.At);
        if (at && a > 0 && a < 120) list.push({ At: at, A: Math.round(a * 1e3) / 1e3 });
      }
      recent[String(Number(k))] = list;
    }
  }
  return {
    Won: [...new Set(won)],
    History: history,
    Recent: recent,
    MilkGiven: Math.max(0, Math.min(1e3, Math.floor(Number(r.MilkGiven) || 0))),
    UpdatedAt: typeof r.UpdatedAt === "string" ? r.UpdatedAt : ""
  };
}
function mergeDuel(a, b) {
  const won = [.../* @__PURE__ */ new Set([...a.Won, ...b.Won])].sort();
  const byAt = /* @__PURE__ */ new Map();
  for (const h of [...a.History, ...b.History]) byAt.set(`${h.At}|${h.Opponent}|${h.Table}`, h);
  const history = [...byAt.values()].sort((x, y) => x.At.localeCompare(y.At)).slice(-MAX_HISTORY);
  const recent = {};
  for (const k of /* @__PURE__ */ new Set([...Object.keys(a.Recent), ...Object.keys(b.Recent)])) {
    const m = /* @__PURE__ */ new Map();
    for (const e of [...a.Recent[k] ?? [], ...b.Recent[k] ?? []]) m.set(e.At, e);
    recent[k] = [...m.values()].sort((x, y) => x.At.localeCompare(y.At)).slice(-MAX_RECENT);
  }
  return { Won: won, History: history, Recent: recent, MilkGiven: Math.max(a.MilkGiven, b.MilkGiven), UpdatedAt: (/* @__PURE__ */ new Date()).toISOString() };
}
async function readDuel(playerId) {
  const r = await client.send(
    new GetItemCommand3({
      TableName: PLAYER_TABLE,
      Key: marshall3({ PlayerID: playerId }),
      ProjectionExpression: "PlayerID, #duel",
      ExpressionAttributeNames: { "#duel": "Duel" }
    })
  );
  const row = r.Item ? unmarshall3(r.Item) : {};
  return normalizeDuel(row.Duel);
}
async function writeDuel(playerId, state) {
  await client.send(
    new UpdateItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall3({ PlayerID: playerId }),
      UpdateExpression: "SET #duel = :d",
      ExpressionAttributeNames: { "#duel": "Duel" },
      ExpressionAttributeValues: marshall3({ ":d": state }, { removeUndefinedValues: true })
    })
  );
}

// updateDuel.ts
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  const body = parseBody(event.body);
  if (!body) return createErrorResponse(400, "Invalid body", { Reason: "InvalidBody" });
  try {
    const merged = mergeDuel(await readDuel(me), normalizeDuel(body));
    await writeDuel(me, merged);
    console.log(`[UpdateDuel] ${me} won=${merged.Won.length} history=${merged.History.length} milkGiven=${merged.MilkGiven}`);
    return createSuccessResponse({ Duel: merged });
  } catch (e) {
    console.error("[UpdateDuel] error", e);
    return createErrorResponse(500, "Duel error", { Reason: "ServerError" });
  }
};
export {
  handler
};
