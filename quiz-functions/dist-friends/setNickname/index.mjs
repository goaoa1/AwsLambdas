// setNickname.ts
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";
import { TransactWriteItemsCommand as TransactWriteItemsCommand2 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall2 } from "@aws-sdk/util-dynamodb";

// profileCatalog.ts
var NICKNAME_ADJECTIVES = [
  "\uC6A9\uAC10\uD55C",
  "\uBC18\uC9DD\uC774\uB294",
  "\uC529\uC529\uD55C",
  "\uB611\uB611\uD55C",
  "\uB0A0\uC318",
  "\uADC0\uC5EC\uC6B4",
  "\uB2E4\uC815\uD55C",
  "\uC2E0\uB098\uB294",
  "\uB290\uAE0B\uD55C",
  "\uC218\uC90D\uC740",
  "\uBA85\uB791\uD55C",
  "\uAF3C\uAF3C\uD55C",
  "\uC7AC\uBE60\uB978",
  "\uB4E0\uB4E0\uD55C",
  "\uC0C1\uB0E5\uD55C",
  "\uD3EC\uADFC\uD55C",
  "\uD798\uC13C",
  "\uD638\uAE30\uC2EC\uB9CE\uC740",
  "\uD2BC\uD2BC\uD55C",
  "\uBD80\uC9C0\uB7F0\uD55C",
  "\uB178\uB798\uD558\uB294",
  "\uCDA4\uCD94\uB294",
  "\uAFC8\uAFB8\uB294",
  "\uC6C3\uB294",
  "\uBE5B\uB098\uB294",
  "\uD558\uB298\uC0C9",
  "\uBD84\uD64D\uBE5B",
  "\uCD08\uB85D\uBE5B",
  "\uB2EC\uCF64\uD55C",
  "\uC0C8\uCF64\uD55C",
  "\uC5C9\uB6B1\uD55C",
  "\uBA4B\uC9C4"
];
var NICKNAME_NOUNS = [
  "\uD310\uB2E4",
  "\uD1A0\uB07C",
  "\uACE0\uC591\uC774",
  "\uAC15\uC544\uC9C0",
  "\uC5EC\uC6B0",
  "\uB2E4\uB78C\uC950",
  "\uD3AD\uADC4",
  "\uCF54\uC54C\uB77C",
  "\uC0AC\uC790",
  "\uD638\uB791\uC774",
  "\uAE30\uB9B0",
  "\uCF54\uB07C\uB9AC",
  "\uC218\uB2EC",
  "\uBD80\uC5C9\uC774",
  "\uB3CC\uACE0\uB798",
  "\uACE0\uB798",
  "\uD584\uC2A4\uD130",
  "\uAC70\uBD81\uC774",
  "\uBCD1\uC544\uB9AC",
  "\uC624\uB9AC",
  "\uC0AC\uC2B4",
  "\uACF0",
  "\uB108\uAD6C\uB9AC",
  "\uACE0\uC2B4\uB3C4\uCE58",
  "\uC575\uBB34\uC0C8",
  "\uB098\uBE44",
  "\uBB34\uB2F9\uBC8C\uB808",
  "\uD574\uB2EC",
  "\uBB3C\uAC1C",
  "\uC5BC\uB8E9\uB9D0",
  "\uCEA5\uAC70\uB8E8",
  "\uC54C\uD30C\uCE74"
];
function isValidNickname(adjective, noun) {
  return NICKNAME_ADJECTIVES.includes(adjective) && NICKNAME_NOUNS.includes(noun);
}
function makeNickname(adjective, noun) {
  return `${adjective}${noun}`;
}
var CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
var FRIEND_CODE_LENGTH = 6;
function randomFriendCode() {
  let s = "";
  for (let i = 0; i < FRIEND_CODE_LENGTH; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}
function formatFriendCode(code) {
  return code.length === FRIEND_CODE_LENGTH ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}
function randomNicknameTag() {
  return 1e3 + Math.floor(Math.random() * 9e3);
}
var handleForCode = (code) => `CODE#${code}`;
var handleForNickname = (nickname, tag) => `NICK#${nickname}#${tag}`;
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
async function readProfile(playerId) {
  const r = await dynamoDBClient.send(
    new GetItemCommand({ TableName: PROFILE_TABLE, Key: marshall({ PlayerID: playerId }), ConsistentRead: true })
  );
  return r.Item ? unmarshall(r.Item) : void 0;
}
function isConditionFailure(e) {
  if (e instanceof TransactionCanceledException) return true;
  return e?.name === "TransactionCanceledException" || e?.name === "ConditionalCheckFailedException";
}
async function ensureProfile(playerId) {
  let profile = await readProfile(playerId);
  if (profile?.FriendCode) return profile;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomFriendCode();
    try {
      await dynamoDBClient.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: HANDLE_TABLE,
                Item: marshall({ Handle: handleForCode(code), PlayerID: playerId, CreatedAt: now }),
                ConditionExpression: "attribute_not_exists(Handle)"
              }
            },
            {
              Update: {
                TableName: PROFILE_TABLE,
                Key: marshall({ PlayerID: playerId }),
                UpdateExpression: "SET FriendCode = :code, CreatedAt = if_not_exists(CreatedAt, :now), UpdatedAt = :now",
                ConditionExpression: "attribute_not_exists(FriendCode)",
                ExpressionAttributeValues: marshall({ ":code": code, ":now": now })
              }
            }
          ]
        })
      );
      break;
    } catch (e) {
      if (!isConditionFailure(e)) throw e;
      profile = await readProfile(playerId);
      if (profile?.FriendCode) return profile;
    }
  }
  profile = await readProfile(playerId);
  if (!profile?.FriendCode) throw new Error("could not allocate friend code");
  return profile;
}
function toClientProfile(p) {
  return {
    PlayerID: p.PlayerID,
    Nickname: p.Nickname ?? "",
    NicknameTag: p.NicknameTag ?? 0,
    FriendCode: p.FriendCode ? formatFriendCode(p.FriendCode) : ""
  };
}

// setNickname.ts
var handler = async (event, _context) => {
  const userId = event.requestContext?.authorizer?.claims?.sub;
  if (!userId) {
    return createErrorResponse(401, "Unauthorized");
  }
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return createErrorResponse(400, "Invalid body", { Reason: "InvalidNickname" });
  }
  const adjective = String(body.Adjective ?? "");
  const noun = String(body.Noun ?? "");
  if (!isValidNickname(adjective, noun)) {
    return createErrorResponse(400, "Invalid nickname", { Reason: "InvalidNickname" });
  }
  const nickname = makeNickname(adjective, noun);
  try {
    const current = await ensureProfile(userId);
    if (current.Nickname === nickname && current.NicknameTag) {
      return createSuccessResponse({ Profile: toClientProfile(current) });
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    for (let attempt = 0; attempt < 8; attempt++) {
      const tag = randomNicknameTag();
      const items = [
        {
          Put: {
            TableName: HANDLE_TABLE,
            Item: marshall2({ Handle: handleForNickname(nickname, tag), PlayerID: userId, CreatedAt: now }),
            ConditionExpression: "attribute_not_exists(Handle)"
          }
        },
        {
          Update: {
            TableName: PROFILE_TABLE,
            Key: marshall2({ PlayerID: userId }),
            UpdateExpression: "SET Nickname = :n, NicknameTag = :t, UpdatedAt = :now",
            ExpressionAttributeValues: marshall2({ ":n": nickname, ":t": tag, ":now": now })
          }
        }
      ];
      if (current.Nickname && current.NicknameTag) {
        items.push({
          Delete: {
            TableName: HANDLE_TABLE,
            Key: marshall2({ Handle: handleForNickname(current.Nickname, current.NicknameTag) }),
            ConditionExpression: "attribute_not_exists(Handle) OR PlayerID = :me",
            ExpressionAttributeValues: marshall2({ ":me": userId })
          }
        });
      }
      try {
        await dynamoDBClient.send(new TransactWriteItemsCommand2({ TransactItems: items }));
        const updated = await readProfile(userId);
        console.log(`[SetNickname] ${userId} -> ${nickname}#${tag}`);
        return createSuccessResponse({ Profile: toClientProfile(updated ?? { ...current, Nickname: nickname, NicknameTag: tag }) });
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
      }
    }
    return createErrorResponse(409, "Nickname busy", { Reason: "Busy" });
  } catch (e) {
    console.error("[SetNickname] error", e);
    return createErrorResponse(500, "Nickname error", { Reason: "ServerError" });
  }
};
export {
  handler
};
