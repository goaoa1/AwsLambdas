// updateAchievementStats.ts
import { unmarshall as unmarshall2 } from "@aws-sdk/util-dynamodb";

// achievementStats.ts
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

// achievementCatalog.ts
var TABLE_QUIZ_IDS = /* @__PURE__ */ new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);

// reality.ts
var MASTERY_AVG_SEC = 3;
var MASTERY_MIN_QUESTIONS = 19;
function isMastery(q) {
  if (!q.QuizID || !TABLE_QUIZ_IDS.has(String(q.QuizID))) return false;
  if (q.WrongCount !== 0) return false;
  const n = Number(q.QuestionCount) || 0;
  const t = Number(q.ElapsedTime) || 0;
  if (n < MASTERY_MIN_QUESTIONS || t <= 0) return false;
  return t / n <= MASTERY_AVG_SEC;
}

// achievementStats.ts
var STATS_TABLE = "PlayerStats";
var client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });
async function addFinishedQuiz(q) {
  const sets = ["LastResultTs = :ts"];
  const adds = ["QuizzesCompleted :one"];
  const values = { ":ts": q.Timestamp, ":one": 1 };
  const names = {};
  const count = Number(q.QuestionCount) || 0;
  if (count > 0) {
    adds.push("CorrectAnswers :correct");
    values[":correct"] = count;
  }
  if (q.QuizID) {
    adds.push("ClearedQuizIds :quiz");
    values[":quiz"] = /* @__PURE__ */ new Set([String(q.QuizID)]);
  }
  if (q.CharacterId) {
    adds.push("CharactersPlayed :char");
    values[":char"] = /* @__PURE__ */ new Set([q.CharacterId]);
  }
  if (q.WrongCount === 0) adds.push("PerfectQuizzes :one");
  if (q.QuizID && isMastery(q)) adds.push("MasteredQuizIds :quiz");
  if (q.LuckyHits && q.LuckyHits > 0) {
    adds.push("LuckyHits :lucky");
    values[":lucky"] = q.LuckyHits;
  }
  if (q.FocusMaxHit) adds.push("FocusMaxQuizzes :one");
  try {
    await client.send(
      new UpdateItemCommand({
        TableName: STATS_TABLE,
        Key: marshall({ PlayerID: q.PlayerID }),
        UpdateExpression: `SET ${sets.join(", ")} ADD ${adds.join(", ")}`,
        ConditionExpression: "attribute_not_exists(LastResultTs) OR LastResultTs < :ts",
        ExpressionAttributeValues: marshall(values, { convertClassInstanceToMap: false }),
        ...Object.keys(names).length ? { ExpressionAttributeNames: names } : {}
      })
    );
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return false;
    throw e;
  }
  const avg = count > 0 && q.ElapsedTime && q.ElapsedTime > 0 ? Math.round(q.ElapsedTime / count * 100) / 100 : void 0;
  if (avg != null) await setIfLower(q.PlayerID, "BestAvgSeconds", avg);
  return true;
}
async function setIfLower(playerId, field, value) {
  try {
    await client.send(
      new UpdateItemCommand({
        TableName: STATS_TABLE,
        Key: marshall({ PlayerID: playerId }),
        UpdateExpression: "SET #f = :v",
        ConditionExpression: "attribute_not_exists(#f) OR #f > :v",
        ExpressionAttributeNames: { "#f": field },
        ExpressionAttributeValues: marshall({ ":v": value })
      })
    );
  } catch (e) {
    if (e.name !== "ConditionalCheckFailedException") throw e;
  }
}

// updateAchievementStats.ts
var handler = async (event) => {
  let applied = 0;
  for (const rec of event.Records ?? []) {
    if (rec.eventName !== "INSERT" || !rec.dynamodb?.NewImage) continue;
    const r = unmarshall2(rec.dynamodb.NewImage);
    if (!r.PlayerID || r.Timestamp == null) continue;
    const quiz = {
      PlayerID: String(r.PlayerID),
      Timestamp: Number(r.Timestamp),
      QuizID: r.QuizID != null ? String(r.QuizID) : void 0,
      QuestionCount: Number(r.QuestionCount) || (Array.isArray(r.QuestionIDs) ? r.QuestionIDs.length : 0),
      ElapsedTime: Number(r.ElapsedTime) || void 0,
      CharacterId: typeof r.CharacterId === "string" ? r.CharacterId : void 0,
      WrongCount: typeof r.WrongCount === "number" ? r.WrongCount : void 0,
      LuckyHits: Number(r.LuckyHits) || 0,
      FocusMaxHit: r.FocusMaxHit === true
    };
    if (await addFinishedQuiz(quiz)) applied++;
  }
  console.log(`[UpdateAchievementStats] records=${event.Records?.length ?? 0} applied=${applied}`);
};
export {
  handler
};
