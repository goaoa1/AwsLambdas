// respondFriendRequest.ts
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";

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
function countStatus(rows, status) {
  return rows.filter((r) => r.Status === status).length;
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
var key = (a, b) => marshall3({ PlayerID: a, OtherID: b });
function setStatus(owner, other, status, now, expected) {
  return {
    Update: {
      TableName: FRIEND_TABLE,
      Key: key(owner, other),
      UpdateExpression: "SET #s = :s, UpdatedAt = :now",
      ConditionExpression: "#s = :expected",
      ExpressionAttributeNames: { "#s": "Status" },
      ExpressionAttributeValues: marshall3({ ":s": status, ":now": now, ":expected": expected })
    }
  };
}
function deleteRow(owner, other) {
  return { Delete: { TableName: FRIEND_TABLE, Key: key(owner, other) } };
}
async function transact(items) {
  await dynamoDBClient.send(new TransactWriteItemsCommand2({ TransactItems: items }));
}
async function acceptRequest(me, other) {
  const [mine, theirs] = await Promise.all([listRows(me), listRows(other)]);
  if (countStatus(mine, "Friend") >= MAX_FRIENDS) return "MyFriendsFull";
  if (countStatus(theirs, "Friend") >= MAX_FRIENDS) return "TheirFriendsFull";
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await transact([setStatus(me, other, "Friend", now, "Received"), setStatus(other, me, "Friend", now, "Sent")]);
  return "ok";
}

// respondFriendRequest.ts
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  const body = parseBody(event.body);
  if (!body || typeof body.Accept !== "boolean") return createErrorResponse(400, "Invalid body", { Reason: Reason.InvalidInput });
  try {
    const other = await resolveFriendCode(String(body.FriendCode ?? ""));
    if (!other) return createErrorResponse(404, "Not found", { Reason: Reason.NotFound });
    const mine = await getRow(me, other);
    if (mine?.Status !== "Received") return createErrorResponse(409, "No request", { Reason: Reason.NoRequest });
    if (body.Accept) {
      try {
        const r = await acceptRequest(me, other);
        if (r !== "ok") return createErrorResponse(409, r, { Reason: r });
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
        return createErrorResponse(409, "No request", { Reason: Reason.NoRequest });
      }
      console.log(`[RespondFriendRequest] ${me} accepted ${other}`);
      return createSuccessResponse({ Result: "Friend", ...await buildFriendLists(me) });
    }
    await transact([deleteRow(me, other), deleteRow(other, me)]);
    console.log(`[RespondFriendRequest] ${me} declined ${other}`);
    return createSuccessResponse({ Result: "Declined", ...await buildFriendLists(me) });
  } catch (e) {
    console.error("[RespondFriendRequest] error", e);
    return createErrorResponse(500, "Friend error", { Reason: "ServerError" });
  }
};
export {
  handler
};
