// getFriends.ts
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";

// friendStore.ts
import { BatchGetItemCommand, GetItemCommand as GetItemCommand2, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall2, unmarshall as unmarshall2 } from "@aws-sdk/util-dynamodb";

// profileCatalog.ts
var FRIEND_CODE_LENGTH = 6;
function formatFriendCode(code) {
  return code.length === FRIEND_CODE_LENGTH ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}
var PROFILE_TABLE = "PlayerProfiles";

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
var FRIEND_TABLE = "Friends";
var MAX_FRIENDS = 50;
var MAX_RECEIVED = 20;
var MAX_SENT = 20;
function getUserId(event) {
  return event.requestContext?.authorizer?.claims?.sub;
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

// giftRules.ts
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

// getFriends.ts
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  try {
    return createSuccessResponse(await buildFriendLists(me));
  } catch (e) {
    console.error("[GetFriends] error", e);
    return createErrorResponse(500, "Friends error", { Reason: "ServerError" });
  }
};
export {
  handler
};
