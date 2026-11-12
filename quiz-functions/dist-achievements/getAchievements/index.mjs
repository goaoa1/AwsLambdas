// getAchievements.ts
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

// achievementCatalog.ts
var TABLE_QUIZ_IDS = /* @__PURE__ */ new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
var TITLES = {
  Title_Conqueror19: "19\uB2E8 \uC815\uBCF5\uC790",
  Title_ZeroMistake: "\uC2E4\uC218 \uC81C\uB85C",
  Title_Lightning: "\uBC88\uAC1C \uC190",
  Title_Attendance: "\uAC1C\uADFC\uC655",
  Title_Lucky: "\uD589\uC6B4\uC544",
  Title_Focus: "\uBAB0\uC785\uC758 \uB2EC\uC778"
};
var EXCLUSIVE_OUTFITS_READY = /* @__PURE__ */ new Set(["Outfit_Exclusive_Scholar"]);
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
function tierReached(a, progress, tier) {
  if (progress == null) return false;
  return a.LowerIsBetter ? progress > 0 && progress <= tier.Goal : progress >= tier.Goal;
}
function tierLocked(tier) {
  return !!tier.Reward.Outfit && !EXCLUSIVE_OUTFITS_READY.has(tier.Reward.Outfit);
}

// profileStore.ts
var dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });

// friendStore.ts
var FRIEND_TABLE = "Friends";
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
function countStatus(rows, status) {
  return rows.filter((r) => r.Status === status).length;
}

// achievementProgress.ts
import { DynamoDBClient as DynamoDBClient3, GetItemCommand as GetItemCommand4, QueryCommand as QueryCommand2 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall4, unmarshall as unmarshall4 } from "@aws-sdk/util-dynamodb";

// achievementStats.ts
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand3, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall3, unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";

// reality.ts
function masteredTables(ids) {
  if (!ids) return [];
  return [...ids].map(String).filter((id) => TABLE_QUIZ_IDS.has(id)).map((id) => 10 + Number(id)).sort((a, b) => a - b);
}

// achievementStats.ts
var STATS_TABLE = "PlayerStats";
var client = new DynamoDBClient2({ region: process.env.REGION || process.env.AWS_REGION });
async function readStats(playerId) {
  const r = await client.send(new GetItemCommand3({ TableName: STATS_TABLE, Key: marshall3({ PlayerID: playerId }) }));
  return r.Item ? unmarshall3(r.Item) : { PlayerID: playerId };
}
async function setIfHigher(playerId, field, value) {
  try {
    await client.send(
      new UpdateItemCommand({
        TableName: STATS_TABLE,
        Key: marshall3({ PlayerID: playerId }),
        UpdateExpression: "SET #f = :v",
        ConditionExpression: "attribute_not_exists(#f) OR #f < :v",
        ExpressionAttributeNames: { "#f": field },
        ExpressionAttributeValues: marshall3({ ":v": value })
      })
    );
  } catch (e) {
    if (e.name !== "ConditionalCheckFailedException") throw e;
  }
}

// itemCatalog.ts
var ITEMS = [
  { ItemId: "Item_StaminaS", Name: "\uC791\uC740 \uBB3C\uC57D", Desc: "\uC2A4\uD0DC\uBBF8\uB098 +1", Stamina: 1, Price: 30 },
  { ItemId: "Item_StaminaL", Name: "\uD070 \uBB3C\uC57D", Desc: "\uC2A4\uD0DC\uBBF8\uB098 +3", Stamina: 3, Price: 80 },
  { ItemId: "Item_StaminaFull", Name: "\uAC00\uB4DD \uCC44\uC6B0\uAE30", Desc: "\uC2A4\uD0DC\uBBF8\uB098\uB97C 10\uAE4C\uC9C0", Stamina: "Full", Price: 200 }
];
function findItem(id) {
  return id ? ITEMS.find((i) => i.ItemId === id) : void 0;
}
var ITEM_NAME = (id) => findItem(id)?.Name ?? id;

// achievementProgress.ts
var ACHIEVEMENT_TABLE = "PlayerAchievements";
var PLAYER_TABLE = "PlayerResources";
var client2 = new DynamoDBClient3({ region: process.env.REGION || process.env.AWS_REGION });
async function computeStats(playerId, extra) {
  const [stats, player, friendRows] = await Promise.all([
    readStats(playerId),
    client2.send(
      new GetItemCommand4({
        TableName: PLAYER_TABLE,
        Key: marshall4({ PlayerID: playerId }),
        ProjectionExpression: "AttendanceStreak, TotalAttendanceDays"
      })
    ),
    listRows(playerId).catch(() => [])
  ]);
  const p = player.Item ? unmarshall4(player.Item) : {};
  if (extra) extra.mastered = masteredTables(stats.MasteredQuizIds);
  const streakNow = Number(p.AttendanceStreak) || 0;
  const streakBest = Math.max(streakNow, Number(stats.AttendanceStreakBest) || 0);
  if (streakNow > (Number(stats.AttendanceStreakBest) || 0)) {
    await setIfHigher(playerId, "AttendanceStreakBest", streakNow).catch((e) => console.error("[achievements] streak best", e));
  }
  return {
    QuizzesCompleted: Number(stats.QuizzesCompleted) || 0,
    ClearedQuizCount: stats.ClearedQuizIds ? [...stats.ClearedQuizIds].filter((id) => TABLE_QUIZ_IDS.has(String(id))).length : 0,
    CorrectAnswers: Number(stats.CorrectAnswers) || 0,
    PerfectQuizzes: Number(stats.PerfectQuizzes) || 0,
    BestAvgSeconds: Number(stats.BestAvgSeconds) || 0,
    // 0 = 아직 기록 없음
    AttendanceStreakBest: streakBest,
    TotalAttendanceDays: Number(p.TotalAttendanceDays) || 0,
    FriendCount: countStatus(friendRows, "Friend"),
    GiftsSent: Number(stats.GiftsSent) || 0,
    CharactersPlayed: stats.CharactersPlayed ? stats.CharactersPlayed.size : 0,
    LuckyHits: Number(stats.LuckyHits) || 0,
    FocusMaxQuizzes: Number(stats.FocusMaxQuizzes) || 0
  };
}
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
function nextClaimableTier(a, progress, claimed) {
  if (claimed >= a.Tiers.length) return -1;
  const tier = a.Tiers[claimed];
  if (tierLocked(tier)) return -1;
  return tierReached(a, progress, tier) ? claimed : -1;
}
function toClientAchievement(a, progress, claimed) {
  const next = nextClaimableTier(a, progress, claimed);
  return {
    Id: a.Id,
    Category: a.Category,
    Name: a.Name,
    Progress: progress,
    LowerIsBetter: !!a.LowerIsBetter,
    ClaimedTiers: claimed,
    Claimable: next >= 0,
    Tiers: a.Tiers.map((t, i) => ({
      Goal: t.Goal,
      Desc: a.Desc.replace("{Goal}", String(t.Goal)),
      Credits: t.Reward.Credits ?? 0,
      Stamina: t.Reward.Stamina ?? 0,
      Title: t.Reward.Title ?? "",
      TitleName: t.Reward.Title ? TITLES[t.Reward.Title] ?? "" : "",
      Outfit: t.Reward.Outfit ?? "",
      Items: Object.entries(t.Reward.Items ?? {}).map(([ItemId, Count]) => ({ ItemId, Name: ITEM_NAME(ItemId), Count })),
      Locked: tierLocked(t),
      Reached: tierReached(a, progress, t),
      Claimed: i < claimed
    }))
  };
}
async function buildAchievementList(playerId) {
  const extra = {};
  const [stats, claimed] = await Promise.all([computeStats(playerId, extra), readClaimed(playerId)]);
  const list = ACHIEVEMENTS.map((a) => toClientAchievement(a, stats[a.Stat], claimed.get(a.Id) ?? 0));
  const titles = [];
  for (const a of ACHIEVEMENTS) {
    const n = claimed.get(a.Id) ?? 0;
    a.Tiers.slice(0, n).forEach((t) => t.Reward.Title && titles.push(t.Reward.Title));
  }
  return {
    Achievements: list,
    ClaimableCount: list.filter((x) => x.Claimable).length,
    Titles: titles.map((id) => ({ Id: id, Name: TITLES[id] ?? id })),
    Stats: stats,
    Mastered: extra.mastered ?? []
  };
}

// getAchievements.ts
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  try {
    return createSuccessResponse(await buildAchievementList(me));
  } catch (e) {
    console.error("[GetAchievements]", e);
    return createErrorResponse(500, "Failed to load achievements");
  }
};
export {
  handler
};
