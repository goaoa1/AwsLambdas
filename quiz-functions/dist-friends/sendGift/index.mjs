// sendGift.ts
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";
import { marshall as marshall5 } from "@aws-sdk/util-dynamodb";

// friendStore.ts
import { BatchGetItemCommand, GetItemCommand as GetItemCommand2, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall2, unmarshall as unmarshall2 } from "@aws-sdk/util-dynamodb";

// profileCatalog.ts
var CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
var FRIEND_CODE_LENGTH = 6;
function formatFriendCode(code) {
  return code.length === FRIEND_CODE_LENGTH ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}
function normalizeFriendCode(input) {
  const s = (input || "").toUpperCase().replace(/[\s-]/g, "");
  if (s.length !== FRIEND_CODE_LENGTH) return "";
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return "";
  return s;
}
var handleForCode = (code) => `CODE#${code}`;
var PROFILE_TABLE = "PlayerProfiles";
var HANDLE_TABLE = "PlayerHandles";

// profileStore.ts
import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
var dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
function isConditionFailure(e) {
  if (e instanceof TransactionCanceledException) return true;
  return e?.name === "TransactionCanceledException" || e?.name === "ConditionalCheckFailedException";
}

// friendStore.ts
var FRIEND_TABLE = "Friends";
var MAX_FRIENDS = 50;
var MAX_RECEIVED = 20;
var MAX_SENT = 20;
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
async function resolveFriendCode(input) {
  const code = normalizeFriendCode(input);
  if (!code) return void 0;
  const r = await dynamoDBClient.send(new GetItemCommand2({ TableName: HANDLE_TABLE, Key: marshall2({ Handle: handleForCode(code) }) }));
  return r.Item ? unmarshall2(r.Item).PlayerID : void 0;
}
async function getRow(playerId, otherId) {
  const r = await dynamoDBClient.send(
    new GetItemCommand2({ TableName: FRIEND_TABLE, Key: marshall2({ PlayerID: playerId, OtherID: otherId }), ConsistentRead: true })
  );
  return r.Item ? unmarshall2(r.Item) : void 0;
}
async function listRows(playerId) {
  const rows = [];
  let start;
  do {
    const r = await dynamoDBClient.send(
      new QueryCommand({
        TableName: FRIEND_TABLE,
        KeyConditionExpression: "PlayerID = :p",
        ExpressionAttributeValues: marshall2({ ":p": playerId }),
        ExclusiveStartKey: start,
        ConsistentRead: true
      })
    );
    for (const it of r.Items ?? []) rows.push(unmarshall2(it));
    start = r.LastEvaluatedKey;
  } while (start);
  return rows;
}
async function getProfiles(ids) {
  const out = /* @__PURE__ */ new Map();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    let keys = unique.slice(i, i + 100).map((id) => marshall2({ PlayerID: id }));
    for (let attempt = 0; attempt < 5 && keys.length; attempt++) {
      const r = await dynamoDBClient.send(
        new BatchGetItemCommand({ RequestItems: { [PROFILE_TABLE]: { Keys: keys, ProjectionExpression: "PlayerID, Nickname, NicknameTag, FriendCode, BestRecords" } } })
      );
      for (const it of r.Responses?.[PROFILE_TABLE] ?? []) {
        const p = unmarshall2(it);
        out.set(p.PlayerID, p);
      }
      keys = r.UnprocessedKeys?.[PROFILE_TABLE]?.Keys ?? [];
    }
  }
  return out;
}
function toEntry(p, status) {
  return {
    FriendCode: p?.FriendCode ? formatFriendCode(p.FriendCode) : "",
    Nickname: p?.Nickname ?? "",
    NicknameTag: p?.NicknameTag ?? 0,
    Status: status
  };
}
var Reason = {
  NotFound: "NotFound",
  // 코드에 맞는 사람이 없음 (나를 막은 사람도 이렇게 보임)
  Self: "Self",
  // 나 자신
  NoNickname: "NoNickname",
  // 내 닉네임을 먼저 정해야 함
  AlreadyFriends: "AlreadyFriends",
  AlreadySent: "AlreadySent",
  Blocked: "Blocked",
  // 내가 막은 사람 (먼저 차단을 풀어야 함)
  MyFriendsFull: "MyFriendsFull",
  TheirFriendsFull: "TheirFriendsFull",
  MySentFull: "MySentFull",
  TheirInboxFull: "TheirInboxFull",
  NoRequest: "NoRequest",
  // 받은 요청이 없음 (상대가 취소함 등)
  NotFriends: "NotFriends",
  InvalidInput: "InvalidInput"
};

// giftRules.ts
var GIFT_STAMINA = 1;
var REGEN_INTERVAL_MS = 10 * 60 * 1e3;
function todayKST(nowMs = Date.now()) {
  return new Date(nowMs + 9 * 60 * 60 * 1e3).toISOString().slice(0, 10);
}

// friendLists.ts
async function buildFriendLists(playerId) {
  const rows = await listRows(playerId);
  const today = todayKST();
  const profiles = await getProfiles([playerId, ...rows.map((r) => r.OtherID)]);
  const pick = (status) => rows.filter((r) => r.Status === status).sort((a, b) => (b.UpdatedAt ?? "").localeCompare(a.UpdatedAt ?? "")).map((r) => {
    const p = profiles.get(r.OtherID);
    const e = toEntry(p, status);
    if (status !== "Friend") return e;
    const extra = r;
    return { ...e, BestRecords: p?.BestRecords ?? {}, GiftSentToday: extra.LastGiftDate === today, GiftPending: Number(extra.GiftPending ?? 0) };
  }).filter((e) => e.FriendCode !== "");
  const me = profiles.get(playerId);
  return {
    Friends: pick("Friend"),
    Received: pick("Received"),
    Sent: pick("Sent"),
    Blocked: pick("Blocked"),
    Me: { ...toEntry(me, "Self"), BestRecords: me?.BestRecords ?? {} },
    GiftsPending: rows.filter((r) => r.Status === "Friend").reduce((n, r) => n + Number(r.GiftPending ?? 0), 0),
    Limits: { MaxFriends: MAX_FRIENDS, MaxReceived: MAX_RECEIVED, MaxSent: MAX_SENT }
  };
}

// friendActions.ts
import { TransactWriteItemsCommand as TransactWriteItemsCommand2 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall3 } from "@aws-sdk/util-dynamodb";
async function transact(items) {
  await dynamoDBClient.send(new TransactWriteItemsCommand2({ TransactItems: items }));
}

// achievementStats.ts
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand3, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall4, unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";
var STATS_TABLE = "PlayerStats";
var client = new DynamoDBClient2({ region: process.env.REGION || process.env.AWS_REGION });
async function addCounter(playerId, field, by = 1) {
  await client.send(
    new UpdateItemCommand({
      TableName: STATS_TABLE,
      Key: marshall4({ PlayerID: playerId }),
      UpdateExpression: "ADD #f :n",
      ExpressionAttributeNames: { "#f": field },
      ExpressionAttributeValues: marshall4({ ":n": by })
    })
  );
}

// sendGift.ts
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  const body = parseBody(event.body);
  try {
    const other = await resolveFriendCode(String(body?.FriendCode ?? ""));
    if (!other) return createErrorResponse(404, "Not found", { Reason: Reason.NotFound });
    const mine = await getRow(me, other);
    if (mine?.Status !== "Friend") return createErrorResponse(403, "Not friends", { Reason: Reason.NotFriends });
    const today = todayKST();
    if (mine.LastGiftDate === today) {
      return createErrorResponse(409, "Already gifted", { Reason: "AlreadyGifted" });
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      await transact([
        {
          Update: {
            TableName: FRIEND_TABLE,
            Key: marshall5({ PlayerID: me, OtherID: other }),
            UpdateExpression: "SET LastGiftDate = :today",
            ConditionExpression: "#s = :friend AND (attribute_not_exists(LastGiftDate) OR LastGiftDate <> :today)",
            ExpressionAttributeNames: { "#s": "Status" },
            ExpressionAttributeValues: marshall5({ ":today": today, ":friend": "Friend" })
          }
        },
        {
          Update: {
            TableName: FRIEND_TABLE,
            Key: marshall5({ PlayerID: other, OtherID: me }),
            UpdateExpression: "ADD GiftPending :one SET LastGiftAt = :now",
            ConditionExpression: "#s = :friend",
            ExpressionAttributeNames: { "#s": "Status" },
            ExpressionAttributeValues: marshall5({ ":one": GIFT_STAMINA, ":now": now, ":friend": "Friend" })
          }
        }
      ]);
    } catch (e) {
      if (!isConditionFailure(e)) throw e;
      return createErrorResponse(409, "Already gifted", { Reason: "AlreadyGifted" });
    }
    console.log(`[SendGift] ${me} -> ${other} (${today})`);
    await addCounter(me, "GiftsSent").catch((e) => console.error("[SendGift] GiftsSent counter failed", e));
    return createSuccessResponse({ Result: "Gifted", ...await buildFriendLists(me) });
  } catch (e) {
    console.error("[SendGift] error", e);
    return createErrorResponse(500, "Gift error", { Reason: "ServerError" });
  }
};
export {
  handler
};
