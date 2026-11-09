// processQuestionAnswer.ts
import { gradeUserAnswer, processQuizStep } from "quiz-utils/gradingManager";
import { getActiveSession, updateSession, finalizeQuizResult } from "quiz-utils/sessionManager";

// characterSkills.ts
var SKILLS = {
  Char_001: "Steady",
  Char_002: "Focus",
  Char_003: "Lucky"
};
var STEADY_MULTIPLIER = 1.2;
var FOCUS_STEP = 0.05;
var FOCUS_MAX = 1.4;
var LUCKY_MULTIPLIER = 1.4;
var LUCKY_CHANCE = 0.5;
function skillFor(characterId) {
  return characterId && SKILLS[characterId] || "None";
}
function focusMultiplier(streakBefore) {
  return Math.min(FOCUS_MAX, Math.round((1 + FOCUS_STEP * Math.max(0, streakBefore)) * 100) / 100);
}
function applySkill(characterId, isCorrect, baseScore, state, random = Math.random) {
  const skill = skillFor(characterId);
  const streakBefore = Math.max(0, state.Streak || 0);
  const base = Number(baseScore) || 0;
  if (!isCorrect) {
    return { SkillId: skill, Multiplier: 1, BaseScore: base, Score: base, Bonus: 0, SkillTriggered: false, Streak: 0 };
  }
  let multiplier = 1;
  let triggered = false;
  switch (skill) {
    case "Steady":
      multiplier = STEADY_MULTIPLIER;
      break;
    case "Focus":
      multiplier = focusMultiplier(streakBefore);
      triggered = multiplier >= FOCUS_MAX;
      break;
    case "Lucky":
      triggered = random() < LUCKY_CHANCE;
      multiplier = triggered ? LUCKY_MULTIPLIER : 1;
      break;
    default:
      multiplier = 1;
  }
  const score = Math.round(base * multiplier);
  return {
    SkillId: skill,
    Multiplier: multiplier,
    BaseScore: base,
    Score: score,
    Bonus: score - base,
    SkillTriggered: triggered,
    Streak: streakBefore + 1
  };
}

// questionStats.ts
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
var QUESTION_STATS_TABLE = "PlayerQuestionStats";
var ddb = new DynamoDBClient({ region: process.env.REGION });
var key = (questionId) => String(questionId).replace(/[^0-9A-Za-z_]/g, "_");
async function recordAnswer(playerId, questionId, correct) {
  const q = key(questionId);
  await ddb.send(
    new UpdateItemCommand({
      TableName: QUESTION_STATS_TABLE,
      Key: { PlayerID: { S: playerId } },
      UpdateExpression: "SET UpdatedAt = :now ADD #a :one, #c :c",
      ExpressionAttributeNames: { "#a": `A_${q}`, "#c": `C_${q}` },
      ExpressionAttributeValues: {
        ":one": { N: "1" },
        ":c": { N: correct ? "1" : "0" },
        ":now": { S: (/* @__PURE__ */ new Date()).toISOString() }
      }
    })
  );
}

// processQuestionAnswer.ts
var json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body)
});
var handler = async (event) => {
  try {
    console.log("[ProcessQuestionAnswer] Lambda invoked");
    const claims = event.requestContext?.authorizer?.claims;
    if (!claims || !claims.sub) {
      return { statusCode: 401, body: JSON.stringify({ Message: "Unauthorized" }) };
    }
    const playerID = claims.sub;
    if (!event.body) {
      return { statusCode: 400, body: JSON.stringify({ Message: "No request body" }) };
    }
    const body = JSON.parse(event.body);
    const userAnswer = body.PlayerAnswer;
    if (userAnswer === void 0 || userAnswer === null) {
      return { statusCode: 400, body: JSON.stringify({ Message: "Answer is required" }) };
    }
    const session = await getActiveSession(playerID);
    if (!session) {
      return { statusCode: 400, body: JSON.stringify({ Message: "No active session" }) };
    }
    const currentQuestionIndex = session.CurrentQuestionIndex || 0;
    const questionIDs = session.QuestionIDs || [];
    const retryQuestionIDs = session.RetryQuestionIDs || [];
    if (currentQuestionIndex >= questionIDs.length && retryQuestionIDs.length === 0) {
      const finalResult = await finalizeQuizResult(session);
      return json(200, {
        Success: true,
        Status: "COMPLETED",
        bIsComplete: true,
        Session: {
          QuizID: finalResult.Session.QuizID,
          Score: finalResult.Session.Score,
          ElapsedTime: finalResult.Session.ElapsedTime
        }
      });
    }
    const bIsRetryPhase = currentQuestionIndex >= questionIDs.length && retryQuestionIDs.length > 0;
    const currentQuestionID = bIsRetryPhase ? retryQuestionIDs[0] : questionIDs[currentQuestionIndex];
    const gradingResult = await gradeUserAnswer(currentQuestionID, userAnswer);
    const skill = applySkill(session.CharacterId, gradingResult.bIsCorrect, gradingResult.Score, {
      Streak: session.Streak ?? 0
    });
    const scoredResult = {
      ...gradingResult,
      Score: skill.Score,
      BaseScore: skill.BaseScore,
      Multiplier: skill.Multiplier,
      Bonus: skill.Bonus,
      SkillId: skill.SkillId,
      SkillTriggered: skill.SkillTriggered,
      Streak: skill.Streak
    };
    await updateSession(playerID, {
      Streak: skill.Streak,
      SkillBonus: (session.SkillBonus ?? 0) + skill.Bonus,
      WrongCount: (session.WrongCount ?? 0) + (gradingResult.bIsCorrect ? 0 : 1),
      LuckyHits: (session.LuckyHits ?? 0) + (skill.SkillId === "Lucky" && skill.SkillTriggered ? 1 : 0),
      FocusMaxHit: !!session.FocusMaxHit || skill.SkillId === "Focus" && skill.SkillTriggered
    });
    console.log(
      `[ProcessQuestionAnswer] ${playerID} q=${currentQuestionID} correct=${gradingResult.bIsCorrect} skill=${skill.SkillId} x${skill.Multiplier} ${skill.BaseScore}->${skill.Score} streak=${skill.Streak}`
    );
    try {
      await recordAnswer(playerID, String(currentQuestionID), !!gradingResult.bIsCorrect);
    } catch (e) {
      console.error("[ProcessQuestionAnswer] question stats update failed:", e);
    }
    const processResult = await processQuizStep(scoredResult, playerID);
    const updatedSession = processResult.Session;
    return json(200, {
      Success: true,
      Status: processResult.Status,
      Result: scoredResult,
      Session: {
        QuestionCount: updatedSession.QuestionIDs.length,
        ...updatedSession
      }
    });
  } catch (error) {
    console.error("[Lambda Error]:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ Success: false, Message: error.message })
    };
  }
};
export {
  handler
};
