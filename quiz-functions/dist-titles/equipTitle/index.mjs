// equipTitle.ts
import { UpdateItemCommand as UpdateItemCommand2 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall5 } from "@aws-sdk/util-dynamodb";
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";

// achievementCatalog.ts
var TITLES = {
  Title_Conqueror19: "19\uB2E8 \uC815\uBCF5\uC790",
  Title_ZeroMistake: "\uC2E4\uC218 \uC81C\uB85C",
  Title_Lightning: "\uBC88\uAC1C \uC190",
  Title_Attendance: "\uAC1C\uADFC\uC655",
  Title_Lucky: "\uD589\uC6B4\uC544",
  Title_Focus: "\uBAB0\uC785\uC758 \uB2EC\uC778"
};
var ACHIEVEMENTS = [
  // ---- 플레이·클리어 ----
  {
    Id: "QuizComplete",
    Category: "Play",
    Name: "\uD034\uC988 \uC644\uC8FC",
    Desc: "\uD034\uC988\uB97C {Goal}\uD310 \uB05D\uAE4C\uC9C0 \uD480\uAE30",
    Stat: "QuizzesCompleted",
    Tiers: [
      { Goal: 1, Reward: { Credits: 20 } },
      { Goal: 10, Reward: { Credits: 50 } },
      { Goal: 30, Reward: { Credits: 100 } },
      { Goal: 100, Reward: { Credits: 200, Items: { Item_StaminaFull: 1 } } },
      { Goal: 300, Reward: { Credits: 400 } }
    ]
  },
  {
    Id: "ClearTables",
    Category: "Play",
    Name: "\uB2E8 \uC815\uBCF5",
    Desc: "\uC11C\uB85C \uB2E4\uB978 \uB2E8 {Goal}\uAC1C \uB05D\uB0B4\uAE30 (11\xD711~19\xD719)",
    Stat: "ClearedQuizCount",
    Tiers: [
      { Goal: 1, Reward: { Credits: 30 } },
      { Goal: 3, Reward: { Credits: 60 } },
      { Goal: 6, Reward: { Credits: 120 } },
      { Goal: 9, Reward: { Title: "Title_Conqueror19" } }
    ]
  },
  {
    Id: "CorrectAnswers",
    Category: "Play",
    Name: "\uB204\uC801 \uC815\uB2F5",
    Desc: "\uC815\uB2F5 {Goal}\uAC1C \uB9DE\uD788\uAE30",
    Stat: "CorrectAnswers",
    Tiers: [
      { Goal: 100, Reward: { Credits: 30 } },
      { Goal: 500, Reward: { Credits: 100 } },
      { Goal: 2e3, Reward: { Credits: 250 } },
      { Goal: 5e3, Reward: { Outfit: "Outfit_Exclusive_Scholar" } }
    ]
  },
  // ---- 실력 ----
  {
    Id: "PerfectQuiz",
    Category: "Skill",
    Name: "\uC644\uBCBD\uD55C \uD034\uC988",
    Desc: "\uD55C \uBC88\uB3C4 \uD2C0\uB9AC\uC9C0 \uC54A\uACE0 {Goal}\uD310 \uB05D\uB0B4\uAE30",
    Stat: "PerfectQuizzes",
    Tiers: [
      { Goal: 1, Reward: { Credits: 50 } },
      { Goal: 10, Reward: { Credits: 150 } },
      { Goal: 50, Reward: { Title: "Title_ZeroMistake" } }
    ]
  },
  {
    Id: "Lightning",
    Category: "Skill",
    Name: "\uBC88\uAC1C \uC190",
    Desc: "\uBB38\uC81C\uB2F9 \uD3C9\uADE0 {Goal}\uCD08 \uC548\uC5D0 \uD55C \uD310 \uB05D\uB0B4\uAE30",
    Stat: "BestAvgSeconds",
    LowerIsBetter: true,
    Tiers: [
      { Goal: 6, Reward: { Credits: 50 } },
      { Goal: 4, Reward: { Credits: 100 } },
      { Goal: 3, Reward: { Title: "Title_Lightning" } }
    ]
  },
  // ---- 습관 ----
  {
    Id: "AttendanceStreak",
    Category: "Habit",
    Name: "\uC5F0\uC18D \uCD9C\uC11D",
    Desc: "{Goal}\uC77C \uC5F0\uC18D \uCD9C\uC11D\uD558\uAE30",
    Stat: "AttendanceStreakBest",
    Tiers: [
      { Goal: 3, Reward: { Items: { Item_StaminaS: 3 } } },
      { Goal: 7, Reward: { Items: { Item_StaminaL: 2 } } },
      { Goal: 14, Reward: { Credits: 100 } },
      { Goal: 30, Reward: { Title: "Title_Attendance" } }
    ]
  },
  {
    Id: "AttendanceTotal",
    Category: "Habit",
    Name: "\uB204\uC801 \uCD9C\uC11D",
    Desc: "\uBAA8\uB450 {Goal}\uC77C \uCD9C\uC11D\uD558\uAE30",
    Stat: "TotalAttendanceDays",
    Tiers: [
      { Goal: 10, Reward: { Credits: 50 } },
      { Goal: 30, Reward: { Credits: 150 } },
      { Goal: 100, Reward: { Credits: 300 } }
    ]
  },
  // ---- 친구·캐릭터 ----
  {
    Id: "Friends",
    Category: "Social",
    Name: "\uCE5C\uAD6C \uC0AC\uADC0\uAE30",
    Desc: "\uCE5C\uAD6C {Goal}\uBA85 \uC0AC\uADC0\uAE30",
    Stat: "FriendCount",
    Tiers: [
      { Goal: 1, Reward: { Credits: 20 } },
      { Goal: 5, Reward: { Credits: 50 } },
      { Goal: 10, Reward: { Credits: 100 } }
    ]
  },
  {
    Id: "GiftsSent",
    Category: "Social",
    Name: "\uC120\uBB3C \uBCF4\uB0B4\uAE30",
    Desc: "\uCE5C\uAD6C\uC5D0\uAC8C \uC120\uBB3C {Goal}\uBC88 \uBCF4\uB0B4\uAE30",
    Stat: "GiftsSent",
    Tiers: [
      { Goal: 1, Reward: { Items: { Item_StaminaS: 2 } } },
      { Goal: 10, Reward: { Credits: 50 } },
      { Goal: 50, Reward: { Credits: 150 } }
    ]
  },
  {
    Id: "AllCharacters",
    Category: "Social",
    Name: "\uBAA8\uB450\uC640 \uD568\uAED8",
    Desc: "\uCE90\uB9AD\uD130 {Goal}\uBA85\uACFC \uAC01\uAC01 \uD034\uC988 \uB05D\uB0B4\uAE30",
    Stat: "CharactersPlayed",
    Tiers: [{ Goal: 3, Reward: { Credits: 100 } }]
  },
  {
    Id: "LuckyHits",
    Category: "Social",
    Name: "\uD589\uC6B4\uC774 \uD130\uC84C\uB2E4",
    Desc: "\uD589\uC6B4 \uC2A4\uD0AC {Goal}\uBC88 \uD130\uB728\uB9AC\uAE30",
    Stat: "LuckyHits",
    Tiers: [
      { Goal: 10, Reward: { Credits: 30 } },
      { Goal: 50, Reward: { Credits: 80 } },
      { Goal: 200, Reward: { Title: "Title_Lucky" } }
    ]
  },
  {
    Id: "FocusMax",
    Category: "Social",
    Name: "\uCD5C\uACE0 \uC9D1\uC911",
    Desc: "\uC9D1\uC911\uB825 \uC2A4\uD0AC \uCD5C\uACE0 \uBC30\uC728(\xD71.4)\uC5D0 {Goal}\uD310 \uB3C4\uB2EC\uD558\uAE30",
    Stat: "FocusMaxQuizzes",
    Tiers: [
      { Goal: 5, Reward: { Credits: 30 } },
      { Goal: 20, Reward: { Credits: 80 } },
      { Goal: 50, Reward: { Title: "Title_Focus" } }
    ]
  }
];

// achievementProgress.ts
import { DynamoDBClient as DynamoDBClient3, GetItemCommand as GetItemCommand4, QueryCommand as QueryCommand2 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall4, unmarshall as unmarshall4 } from "@aws-sdk/util-dynamodb";

// achievementStats.ts
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
var client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });

// friendStore.ts
import { BatchGetItemCommand, GetItemCommand as GetItemCommand3, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall3, unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";

// profileCatalog.ts
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
var handleForCode = (code) => `CODE#${code}`;
var PROFILE_TABLE = "PlayerProfiles";
var HANDLE_TABLE = "PlayerHandles";

// profileStore.ts
import {
  DynamoDBClient as DynamoDBClient2,
  GetItemCommand as GetItemCommand2,
  TransactWriteItemsCommand,
  TransactionCanceledException
} from "@aws-sdk/client-dynamodb";
import { marshall as marshall2, unmarshall as unmarshall2 } from "@aws-sdk/util-dynamodb";
var dynamoDBClient = new DynamoDBClient2({ region: process.env.REGION });
function titleNameOf(id) {
  return id ? TITLES[id] ?? "" : "";
}
async function readProfile(playerId) {
  const r = await dynamoDBClient.send(
    new GetItemCommand2({ TableName: PROFILE_TABLE, Key: marshall2({ PlayerID: playerId }), ConsistentRead: true })
  );
  return r.Item ? unmarshall2(r.Item) : void 0;
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
                Item: marshall2({ Handle: handleForCode(code), PlayerID: playerId, CreatedAt: now }),
                ConditionExpression: "attribute_not_exists(Handle)"
              }
            },
            {
              Update: {
                TableName: PROFILE_TABLE,
                Key: marshall2({ PlayerID: playerId }),
                UpdateExpression: "SET FriendCode = :code, CreatedAt = if_not_exists(CreatedAt, :now), UpdatedAt = :now",
                ConditionExpression: "attribute_not_exists(FriendCode)",
                ExpressionAttributeValues: marshall2({ ":code": code, ":now": now })
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
    FriendCode: p.FriendCode ? formatFriendCode(p.FriendCode) : "",
    TitleId: p.EquippedTitle ?? "",
    Title: titleNameOf(p.EquippedTitle)
  };
}

// achievementProgress.ts
var ACHIEVEMENT_TABLE = "PlayerAchievements";
var client2 = new DynamoDBClient3({ region: process.env.REGION || process.env.AWS_REGION });
async function readClaimed(playerId) {
  const out = /* @__PURE__ */ new Map();
  let start;
  do {
    const r = await client2.send(
      new QueryCommand2({
        TableName: ACHIEVEMENT_TABLE,
        KeyConditionExpression: "PlayerID = :p",
        ExpressionAttributeValues: marshall4({ ":p": playerId }),
        ExclusiveStartKey: start
      })
    );
    for (const it of r.Items ?? []) {
      const row = unmarshall4(it);
      out.set(row.AchievementId, Number(row.ClaimedTiers) || 0);
    }
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

// equipTitle.ts
async function ownedTitleIds(playerId) {
  const claimed = await readClaimed(playerId);
  const ids = [];
  for (const a of ACHIEVEMENTS) {
    a.Tiers.slice(0, claimed.get(a.Id) ?? 0).forEach((t) => t.Reward.Title && ids.push(t.Reward.Title));
  }
  return ids;
}
var handler = async (event) => {
  const me = event.requestContext?.authorizer?.claims?.sub;
  if (!me) return createErrorResponse(401, "Unauthorized");
  let titleId = "";
  try {
    titleId = String(JSON.parse(event.body || "{}")?.TitleId ?? "").trim();
  } catch {
    return createErrorResponse(400, "Bad body", { Reason: "BadRequest" });
  }
  try {
    const owned = await ownedTitleIds(me);
    if (titleId && !owned.includes(titleId)) {
      return createErrorResponse(403, "Title not owned", { Reason: "NotOwned" });
    }
    await ensureProfile(me);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await dynamoDBClient.send(
      new UpdateItemCommand2({
        TableName: PROFILE_TABLE,
        Key: marshall5({ PlayerID: me }),
        UpdateExpression: titleId ? "SET EquippedTitle = :t, UpdatedAt = :now" : "REMOVE EquippedTitle SET UpdatedAt = :now",
        ExpressionAttributeValues: marshall5(titleId ? { ":t": titleId, ":now": now } : { ":now": now })
      })
    );
    const profile = await readProfile(me);
    console.log(`[EquipTitle] ${me} -> ${titleId || "(none)"}`);
    return createSuccessResponse({
      Profile: toClientProfile(profile ?? { PlayerID: me }),
      Titles: owned.map((id) => ({ Id: id, Name: TITLES[id] ?? id }))
    });
  } catch (e) {
    console.error("[EquipTitle] error", e);
    return createErrorResponse(500, "Equip title error", { Reason: "ServerError" });
  }
};
export {
  handler,
  ownedTitleIds
};
