// searchPlayers.ts
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";
import { QueryCommand as QueryCommand2 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall3, unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";

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

// achievementCatalog.ts
var TITLES = {
  Title_Conqueror19: "19\uB2E8 \uC815\uBCF5\uC790",
  Title_ZeroMistake: "\uC2E4\uC218 \uC81C\uB85C",
  Title_Lightning: "\uBC88\uAC1C \uC190",
  Title_Attendance: "\uAC1C\uADFC\uC655",
  Title_Lucky: "\uD589\uC6B4\uC544",
  Title_Focus: "\uBAB0\uC785\uC758 \uB2EC\uC778"
};

// profileStore.ts
var dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
function titleNameOf(id) {
  return id ? TITLES[id] ?? "" : "";
}

// friendStore.ts
import { BatchGetItemCommand, GetItemCommand as GetItemCommand2, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall2, unmarshall as unmarshall2 } from "@aws-sdk/util-dynamodb";
var FRIEND_TABLE = "Friends";
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
async function getProfiles(ids) {
  const out = /* @__PURE__ */ new Map();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    let keys = unique.slice(i, i + 100).map((id) => marshall2({ PlayerID: id }));
    for (let attempt = 0; attempt < 5 && keys.length; attempt++) {
      const r = await dynamoDBClient.send(
        new BatchGetItemCommand({ RequestItems: { [PROFILE_TABLE]: { Keys: keys, ProjectionExpression: "PlayerID, Nickname, NicknameTag, FriendCode, BestRecords, EquippedTitle" } } })
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
    Title: titleNameOf(p?.EquippedTitle),
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

// searchPlayers.ts
var MAX_RESULTS = 10;
async function findByNickname(query) {
  const m = query.replace(/\s/g, "").match(/^(.+?)(?:#(\d{4}))?$/);
  if (!m) return [];
  const nickname = m[1];
  const tag = m[2] ? Number(m[2]) : void 0;
  const r = await dynamoDBClient.send(
    new QueryCommand2({
      TableName: PROFILE_TABLE,
      IndexName: "NicknameIndex",
      KeyConditionExpression: tag === void 0 ? "Nickname = :n" : "Nickname = :n AND NicknameTag = :t",
      ExpressionAttributeValues: marshall3(tag === void 0 ? { ":n": nickname } : { ":n": nickname, ":t": tag }),
      Limit: 30
    })
  );
  return (r.Items ?? []).map((it) => unmarshall3(it).PlayerID);
}
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  const body = parseBody(event.body);
  const query = String(body?.Query ?? "").trim();
  if (!query || query.length > 40) return createErrorResponse(400, "Invalid query", { Reason: Reason.InvalidInput });
  try {
    let ids = [];
    if (normalizeFriendCode(query)) {
      const id = await resolveFriendCode(query);
      if (id) ids = [id];
    }
    if (ids.length === 0) {
      ids = await findByNickname(query);
    }
    const results = [];
    const profiles = await getProfiles(ids);
    for (const id of ids) {
      if (results.length >= MAX_RESULTS) break;
      const p = profiles.get(id);
      if (!p?.FriendCode || !p.Nickname) continue;
      if (id === me) {
        results.push(toEntry(p, "Self"));
        continue;
      }
      const theirs = await getRow(id, me);
      if (theirs?.Status === "Blocked") continue;
      const mine = await getRow(me, id);
      results.push(toEntry(p, mine?.Status ?? "None"));
    }
    console.log(`[SearchPlayers] ${me} '${query}' -> ${results.length}`);
    return createSuccessResponse({ Results: results });
  } catch (e) {
    console.error("[SearchPlayers] error", e);
    return createErrorResponse(500, "Search error", { Reason: "ServerError" });
  }
};
export {
  handler
};
