// claimGifts.ts
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";
import { GetItemCommand as GetItemCommand3 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall4, unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";

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
var MAX_STAMINA = 10;
var REGEN_INTERVAL_MS = 10 * 60 * 1e3;
function todayKST(nowMs = Date.now()) {
  return new Date(nowMs + 9 * 60 * 60 * 1e3).toISOString().slice(0, 10);
}
function effectiveStamina(stored, lastUpdateAt, nowMs = Date.now()) {
  if (stored >= MAX_STAMINA || lastUpdateAt == null) return { stamina: Math.min(stored, MAX_STAMINA), clock: lastUpdateAt };
  const regen = Math.floor((nowMs - lastUpdateAt) / REGEN_INTERVAL_MS);
  if (regen <= 0) return { stamina: stored, clock: lastUpdateAt };
  const stamina = Math.min(stored + regen, MAX_STAMINA);
  return { stamina, clock: stamina >= MAX_STAMINA ? void 0 : lastUpdateAt + regen * REGEN_INTERVAL_MS };
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

// claimGifts.ts
var PLAYER_TABLE = "PlayerResources";
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const rows = (await listRows(me)).filter((r) => r.Status === "Friend" && Number(r.GiftPending ?? 0) > 0);
      const total = rows.reduce((n, r) => n + Number(r.GiftPending ?? 0), 0);
      if (total === 0) return createErrorResponse(409, "No gifts", { Reason: "NoGifts" });
      const res = await dynamoDBClient.send(
        new GetItemCommand3({ TableName: PLAYER_TABLE, Key: marshall4({ PlayerID: me }), ProjectionExpression: "Stamina, LastStaminaUpdateAt", ConsistentRead: true })
      );
      const player = res.Item ? unmarshall3(res.Item) : {};
      const stored = Number(player.Stamina ?? MAX_STAMINA);
      const { stamina, clock } = effectiveStamina(stored, player.LastStaminaUpdateAt);
      const room = MAX_STAMINA - stamina;
      if (room <= 0) return createErrorResponse(409, "Stamina full", { Reason: "StaminaFull", Stamina: stamina, Pending: total });
      rows.sort((a, b) => String(a.LastGiftAt ?? "").localeCompare(String(b.LastGiftAt ?? "")));
      let left = Math.min(room, total);
      const claimed = left;
      const items = [];
      for (const r of rows) {
        if (left <= 0) break;
        const pending = Number(r.GiftPending ?? 0);
        const take = Math.min(pending, left);
        left -= take;
        items.push({
          Update: {
            TableName: FRIEND_TABLE,
            Key: marshall4({ PlayerID: me, OtherID: r.OtherID }),
            UpdateExpression: "SET GiftPending = GiftPending - :n",
            ConditionExpression: "GiftPending >= :n",
            ExpressionAttributeValues: marshall4({ ":n": take })
          }
        });
      }
      const newStamina = stamina + claimed;
      const full = newStamina >= MAX_STAMINA;
      const cond = player.Stamina === void 0 ? "attribute_not_exists(Stamina)" : "Stamina = :old";
      const values = { ":s": newStamina, ":now": (/* @__PURE__ */ new Date()).toISOString() };
      if (player.Stamina !== void 0) values[":old"] = stored;
      if (!full && clock !== void 0) values[":clock"] = clock;
      items.push({
        Update: {
          TableName: PLAYER_TABLE,
          Key: marshall4({ PlayerID: me }),
          UpdateExpression: full ? "SET Stamina = :s, UpdatedAt = :now REMOVE LastStaminaUpdateAt" : clock !== void 0 ? "SET Stamina = :s, UpdatedAt = :now, LastStaminaUpdateAt = :clock" : "SET Stamina = :s, UpdatedAt = :now",
          ConditionExpression: cond,
          ExpressionAttributeValues: marshall4(values)
        }
      });
      try {
        await transact(items);
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
        continue;
      }
      console.log(`[ClaimGifts] ${me} +${claimed} -> ${newStamina} (left ${total - claimed})`);
      return createSuccessResponse({ Result: "Claimed", Claimed: claimed, Stamina: newStamina, Remaining: total - claimed, ...await buildFriendLists(me) });
    }
    return createErrorResponse(409, "Busy", { Reason: "Busy" });
  } catch (e) {
    console.error("[ClaimGifts] error", e);
    return createErrorResponse(500, "Gift error", { Reason: "ServerError" });
  }
};
export {
  handler
};
