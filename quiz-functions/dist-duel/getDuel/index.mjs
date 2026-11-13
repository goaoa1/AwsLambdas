// getDuel.ts
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

// duelStore.ts
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand3, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall3, unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";
var PLAYER_TABLE = "PlayerResources";
var client = new DynamoDBClient2({ region: process.env.REGION || process.env.AWS_REGION });
var OPPONENTS = /* @__PURE__ */ new Set(["Char_001", "Char_002", "Char_003"]);
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

// getDuel.ts
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  try {
    const duel = await readDuel(me);
    console.log(`[GetDuel] ${me} won=${duel.Won.length} history=${duel.History.length} milkGiven=${duel.MilkGiven}`);
    return createSuccessResponse({ Duel: duel });
  } catch (e) {
    console.error("[GetDuel] error", e);
    return createErrorResponse(500, "Duel error", { Reason: "ServerError" });
  }
};
export {
  handler
};
