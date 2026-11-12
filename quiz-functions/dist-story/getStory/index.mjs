// getStory.ts
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

// achievementStats.ts
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand3, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall3, unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";
var STATS_TABLE = "PlayerStats";
var client = new DynamoDBClient2({ region: process.env.REGION || process.env.AWS_REGION });
async function readStats(playerId) {
  const r = await client.send(new GetItemCommand3({ TableName: STATS_TABLE, Key: marshall3({ PlayerID: playerId }) }));
  return r.Item ? unmarshall3(r.Item) : { PlayerID: playerId };
}

// storyStore.ts
import { DynamoDBClient as DynamoDBClient3, GetItemCommand as GetItemCommand4, UpdateItemCommand as UpdateItemCommand2 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall4, unmarshall as unmarshall4 } from "@aws-sdk/util-dynamodb";
var PLAYER_TABLE = "PlayerResources";
var client2 = new DynamoDBClient3({ region: process.env.REGION || process.env.AWS_REGION });
var CHARACTER_IDS = /* @__PURE__ */ new Set(["Char_001", "Char_002", "Char_003"]);
var STORY_KEYS = /* @__PURE__ */ new Set([...CHARACTER_IDS, "Reality"]);
var strList = (v) => {
  if (Array.isArray(v)) return v.map(String);
  if (v instanceof Set) return [...v].map(String);
  return [];
};
function normalizeCharState(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const choices = {};
  if (r.Choices && typeof r.Choices === "object") for (const [k, v] of Object.entries(r.Choices)) choices[k] = String(v);
  return {
    Affinity: Math.max(0, Math.floor(Number(r.Affinity) || 0)),
    Seen: strList(r.Seen),
    Events: strList(r.Events),
    Flags: strList(r.Flags),
    Unlocked: strList(r.Unlocked),
    Claimed: strList(r.Claimed),
    Choices: choices,
    LastEpisodeDate: typeof r.LastEpisodeDate === "string" ? r.LastEpisodeDate : "",
    TapDate: typeof r.TapDate === "string" ? r.TapDate : "",
    TapPointsToday: Math.max(0, Math.floor(Number(r.TapPointsToday) || 0)),
    UpdatedAt: typeof r.UpdatedAt === "string" ? r.UpdatedAt : ""
  };
}
async function readStoryRow(playerId) {
  const r = await client2.send(
    new GetItemCommand4({
      TableName: PLAYER_TABLE,
      Key: marshall4({ PlayerID: playerId }),
      ProjectionExpression: "PlayerID, #story, AttendanceStreak, TotalAttendanceDays, OwnedOutfits",
      ExpressionAttributeNames: { "#story": "Story" }
    })
  );
  const row = r.Item ? unmarshall4(r.Item) : {};
  const story = {};
  for (const [k, v] of Object.entries(row.Story ?? {})) story[k] = normalizeCharState(v);
  return { Story: story, Row: row };
}

// storyCatalog.ts
var STORY_REWARDS = {
  potion_reaction: { Items: { Item_StaminaS: 1 } },
  // 서윤 8화 '매점': 작은 물약 1개
  tie_reward: { Outfit: "Outfit_Acc_Necktie" }
  // 서윤 15화 '만점': 부장 넥타이
};

// getStory.ts
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  try {
    const [stats, { Story, Row }] = await Promise.all([readStats(me), readStoryRow(me)]);
    const quizzes = Number(stats.QuizzesCompleted) || 0;
    const cleared = /* @__PURE__ */ new Set();
    for (const id of stats.ClearedQuizIds ? [...stats.ClearedQuizIds] : []) {
      const n = Number(id);
      if (n >= 1 && n <= 9) cleared.add(10 + n);
    }
    const streak = Number(Row.AttendanceStreak) || 0;
    const total = Number(Row.TotalAttendanceDays) || 0;
    const flags = [];
    if (quizzes >= 1) flags.push("first_quiz_done");
    for (const s of [...cleared].sort((a, b) => a - b)) {
      flags.push(`stage${s}_played`, `stage${s}_cleared`);
    }
    flags.push(total > streak ? "streak_broken" : "streak_unbroken");
    console.log(`[GetStory] ${me} chars=${Object.keys(Story).length} quizzes=${quizzes} cleared=${[...cleared].join(",")}`);
    return createSuccessResponse({
      Story,
      Rewards: Object.keys(STORY_REWARDS),
      // 보상이 있는 해금 id — 클라이언트가 이것만 claim-story-unlock 한다
      Server: { QuizzesCompleted: quizzes, ClearedStages: [...cleared].sort((a, b) => a - b), AttendanceStreak: streak, TotalAttendanceDays: total, Flags: flags }
    });
  } catch (e) {
    console.error("[GetStory] error", e);
    return createErrorResponse(500, "Story error", { Reason: "ServerError" });
  }
};
export {
  handler
};
