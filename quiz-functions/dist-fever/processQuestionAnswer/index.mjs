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

// fever.ts
var FEVER_GAUGE_MAX = 100;
var GAUGE_CORRECT = 20;
var GAUGE_PERFECT = 30;
var GAUGE_WRONG = 50;
var FEVER_LENGTH = 5;
var FEVER_MULTIPLIER = 2;
var PERFECT_MS = 3e3;
var PERFECT_MIN_MS = 400;
var PERFECT_MULTIPLIER = 1.2;
var SLOW_MS = 1e4;
function isSlow(answerMs) {
  return typeof answerMs === "number" && Number.isFinite(answerMs) && answerMs > SLOW_MS;
}
function isPerfect(answerMs) {
  return typeof answerMs === "number" && Number.isFinite(answerMs) && answerMs >= PERFECT_MIN_MS && answerMs <= PERFECT_MS;
}
function applyFever(isCorrect, skillRaw, skillScore, answerMs, state) {
  let gauge = Math.min(FEVER_GAUGE_MAX, Math.max(0, Number(state.FeverGauge) || 0));
  let left = Math.max(0, Math.floor(Number(state.FeverLeft) || 0));
  const inFever = left > 0;
  if (!isCorrect) {
    return {
      Perfect: false,
      Slow: false,
      FeverActive: inFever,
      FeverStarted: false,
      FeverEnded: inFever,
      FeverGauge: inFever ? 0 : Math.max(0, gauge - GAUGE_WRONG),
      FeverLeft: 0,
      Score: 0,
      PerfectBonus: 0,
      FeverBonus: 0
    };
  }
  if (isSlow(answerMs)) {
    return {
      Perfect: false,
      Slow: true,
      FeverActive: false,
      FeverStarted: false,
      FeverEnded: inFever,
      FeverGauge: inFever ? 0 : gauge,
      FeverLeft: 0,
      Score: skillScore,
      PerfectBonus: 0,
      FeverBonus: 0
    };
  }
  const perfect = isPerfect(answerMs);
  const afterPerfect = skillRaw * (perfect ? PERFECT_MULTIPLIER : 1);
  const afterFever = afterPerfect * (inFever ? FEVER_MULTIPLIER : 1);
  const score = Math.round(afterFever);
  const perfectBonus = Math.round(afterPerfect) - skillScore;
  const feverBonus = score - Math.round(afterPerfect);
  let started = false;
  let ended = false;
  if (inFever) {
    left -= 1;
    ended = left === 0;
    gauge = 0;
  } else {
    gauge += perfect ? GAUGE_PERFECT : GAUGE_CORRECT;
    if (gauge >= FEVER_GAUGE_MAX) {
      gauge = 0;
      left = FEVER_LENGTH;
      started = true;
    }
  }
  return {
    Perfect: perfect,
    Slow: false,
    FeverActive: inFever,
    FeverStarted: started,
    FeverEnded: ended,
    FeverGauge: gauge,
    FeverLeft: left,
    Score: score,
    PerfectBonus: perfectBonus,
    FeverBonus: feverBonus
  };
}
var FEVER_MS = 15e3;
var FEVER_MIN_TICK_MS = PERFECT_MIN_MS;
var GAUGE_IDLE_DRAIN_PER_SEC = 2;
function idleDrainFor(answerMs) {
  if (typeof answerMs !== "number" || !Number.isFinite(answerMs)) return 0;
  return Math.round(Math.max(FEVER_MIN_TICK_MS, answerMs) / 1e3 * GAUGE_IDLE_DRAIN_PER_SEC);
}
function applyFeverV2(isCorrect, skillRaw, skillScore, answerMs, state, options = {}) {
  let gauge = Math.min(FEVER_GAUGE_MAX, Math.max(0, Number(state.FeverGauge) || 0));
  const msLeft = Math.max(0, Math.floor(Number(state.FeverMsLeft) || 0));
  const inFever = msLeft > 0;
  const used = typeof answerMs === "number" && Number.isFinite(answerMs) ? Math.max(FEVER_MIN_TICK_MS, answerMs) : FEVER_MS;
  const inTime = inFever && used <= msLeft;
  let drained = 0;
  if (!inFever && options.idleDrain) {
    drained = Math.min(gauge, idleDrainFor(answerMs));
    gauge -= drained;
  }
  if (!isCorrect) {
    return {
      Perfect: false,
      Slow: false,
      FeverActive: inFever,
      FeverStarted: false,
      FeverEnded: inFever,
      FeverGauge: inFever ? 0 : Math.max(0, gauge - GAUGE_WRONG),
      FeverLeft: 0,
      FeverMsLeft: 0,
      Score: 0,
      PerfectBonus: 0,
      FeverBonus: 0,
      GaugeDrained: drained
    };
  }
  if (inFever) {
    const perfect2 = isPerfect(answerMs);
    const afterPerfect = skillRaw * (perfect2 ? PERFECT_MULTIPLIER : 1);
    const score2 = Math.round(afterPerfect * (inTime ? FEVER_MULTIPLIER : 1));
    const left = inTime ? msLeft - used : 0;
    const ended = left <= 0;
    return {
      Perfect: perfect2,
      Slow: false,
      FeverActive: inTime,
      FeverStarted: false,
      FeverEnded: ended,
      FeverGauge: 0,
      FeverLeft: ended ? 0 : 1,
      FeverMsLeft: Math.max(0, left),
      Score: score2,
      PerfectBonus: Math.round(afterPerfect) - skillScore,
      FeverBonus: score2 - Math.round(afterPerfect),
      GaugeDrained: 0
    };
  }
  if (isSlow(answerMs)) {
    return {
      Perfect: false,
      Slow: true,
      FeverActive: false,
      FeverStarted: false,
      FeverEnded: false,
      FeverGauge: gauge,
      FeverLeft: 0,
      FeverMsLeft: 0,
      Score: skillScore,
      PerfectBonus: 0,
      FeverBonus: 0,
      GaugeDrained: drained
    };
  }
  const perfect = isPerfect(answerMs);
  const score = Math.round(skillRaw * (perfect ? PERFECT_MULTIPLIER : 1));
  gauge += perfect ? GAUGE_PERFECT : GAUGE_CORRECT;
  let started = false;
  let ms = 0;
  if (gauge >= FEVER_GAUGE_MAX) {
    gauge = 0;
    ms = FEVER_MS;
    started = true;
  }
  return {
    Perfect: perfect,
    Slow: false,
    FeverActive: false,
    FeverStarted: started,
    FeverEnded: false,
    FeverGauge: gauge,
    FeverLeft: started ? 1 : 0,
    FeverMsLeft: ms,
    Score: score,
    PerfectBonus: score - skillScore,
    FeverBonus: 0,
    GaugeDrained: drained
  };
}

// difficulty.ts
var DIFFICULTIES = {
  easy: { base: 200, timeScale: 1 },
  normal: { base: 300, timeScale: 1 },
  hard: { base: 400, timeScale: 2 },
  veryhard: { base: 500, timeScale: 3 }
};
function parseDifficulty(v) {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(DIFFICULTIES, v) ? v : void 0;
}
function timeScale(difficulty) {
  const d = parseDifficulty(difficulty);
  return d ? DIFFICULTIES[d].timeScale : 1;
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

// quizMilk.ts
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand2, UpdateItemCommand as UpdateItemCommand2 } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
var client = new DynamoDBClient2({ region: process.env.REGION || process.env.AWS_REGION });
var PLAYER_TABLE = "PlayerResources";
var QUIZ_MILK_PER_QUIZ = 1;
var QUIZ_MILK_DAILY_CAP = 5;
function kstDay(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1e3).toISOString().slice(0, 10);
}
var isConditional = (e) => e?.name === "ConditionalCheckFailedException";
function toGrant(attrs, gift, day) {
  const a = attrs ? unmarshall(attrs) : {};
  const total = Number(a.QuizMilk);
  const today = a.QuizMilkDay === day ? Number(a.QuizMilkToday) : 0;
  return {
    gift,
    total: Number.isFinite(total) && total > 0 ? Math.floor(total) : 0,
    today: Number.isFinite(today) && today > 0 ? Math.floor(today) : 0,
    cap: QUIZ_MILK_DAILY_CAP
  };
}
async function grantQuizMilk(playerId, n = QUIZ_MILK_PER_QUIZ, now = Date.now()) {
  const day = kstDay(now);
  const Key = marshall({ PlayerID: playerId });
  try {
    const r2 = await client.send(
      new UpdateItemCommand2({
        TableName: PLAYER_TABLE,
        Key,
        UpdateExpression: "ADD QuizMilk :n, QuizMilkToday :n",
        ConditionExpression: "attribute_exists(PlayerID) AND QuizMilkDay = :day AND QuizMilkToday < :cap",
        ExpressionAttributeValues: marshall({ ":n": n, ":day": day, ":cap": QUIZ_MILK_DAILY_CAP }),
        ReturnValues: "ALL_NEW"
      })
    );
    return toGrant(r2.Attributes, n, day);
  } catch (e) {
    if (!isConditional(e)) throw e;
  }
  try {
    const r2 = await client.send(
      new UpdateItemCommand2({
        TableName: PLAYER_TABLE,
        Key,
        UpdateExpression: "SET QuizMilkDay = :day, QuizMilkToday = :n ADD QuizMilk :n",
        ConditionExpression: "attribute_exists(PlayerID) AND (attribute_not_exists(QuizMilkDay) OR QuizMilkDay <> :day)",
        ExpressionAttributeValues: marshall({ ":n": n, ":day": day }),
        ReturnValues: "ALL_NEW"
      })
    );
    return toGrant(r2.Attributes, n, day);
  } catch (e) {
    if (!isConditional(e)) throw e;
  }
  const r = await client.send(
    new GetItemCommand2({
      TableName: PLAYER_TABLE,
      Key,
      ProjectionExpression: "QuizMilk, QuizMilkDay, QuizMilkToday"
    })
  );
  return toGrant(r.Item, 0, day);
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
    const feverMode = body.Fever === 2 ? 2 : body.Fever === true ? 1 : 0;
    const gaugeDrain = feverMode === 2 && body.GaugeDrain === true;
    const answerMs = typeof body.AnswerMs === "number" ? body.AnswerMs : void 0;
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
    const scale = timeScale(session.Difficulty);
    const feverMs = answerMs !== void 0 ? Math.round(answerMs / scale) : void 0;
    const fever = feverMode === 2 ? applyFeverV2(
      !!gradingResult.bIsCorrect,
      skill.BaseScore * skill.Multiplier,
      skill.Score,
      feverMs,
      { FeverGauge: session.FeverGauge ?? 0, FeverMsLeft: session.FeverMsLeft ?? 0 },
      { idleDrain: gaugeDrain }
    ) : feverMode === 1 ? applyFever(!!gradingResult.bIsCorrect, skill.BaseScore * skill.Multiplier, skill.Score, feverMs, {
      FeverGauge: session.FeverGauge ?? 0,
      FeverLeft: session.FeverLeft ?? 0
    }) : null;
    const feverMsLeft = fever && "FeverMsLeft" in fever ? fever.FeverMsLeft : void 0;
    const gaugeDrained = gaugeDrain && fever && "GaugeDrained" in fever ? fever.GaugeDrained : void 0;
    const scoredResult = {
      ...gradingResult,
      Score: fever && gradingResult.bIsCorrect ? fever.Score : skill.Score,
      BaseScore: skill.BaseScore,
      Multiplier: skill.Multiplier,
      Bonus: skill.Bonus,
      SkillId: skill.SkillId,
      SkillTriggered: skill.SkillTriggered,
      Streak: skill.Streak,
      ...fever ? {
        Combo: skill.Streak,
        Perfect: fever.Perfect,
        Slow: fever.Slow,
        FeverActive: fever.FeverActive,
        FeverStarted: fever.FeverStarted,
        FeverEnded: fever.FeverEnded,
        FeverGauge: fever.FeverGauge,
        FeverLeft: fever.FeverLeft,
        PerfectBonus: fever.PerfectBonus,
        FeverBonus: fever.FeverBonus,
        ...feverMsLeft !== void 0 ? { FeverMsLeft: feverMsLeft } : {},
        ...gaugeDrained !== void 0 ? { GaugeDrained: gaugeDrained } : {}
      } : {}
    };
    await updateSession(playerID, {
      Streak: skill.Streak,
      SkillBonus: (session.SkillBonus ?? 0) + skill.Bonus,
      WrongCount: (session.WrongCount ?? 0) + (gradingResult.bIsCorrect ? 0 : 1),
      LuckyHits: (session.LuckyHits ?? 0) + (skill.SkillId === "Lucky" && skill.SkillTriggered ? 1 : 0),
      FocusMaxHit: !!session.FocusMaxHit || skill.SkillId === "Focus" && skill.SkillTriggered,
      ...fever ? {
        FeverGauge: fever.FeverGauge,
        FeverLeft: fever.FeverLeft,
        ...feverMsLeft !== void 0 ? { FeverMsLeft: feverMsLeft } : {},
        PerfectCount: (session.PerfectCount ?? 0) + (fever.Perfect ? 1 : 0),
        FeverCount: (session.FeverCount ?? 0) + (fever.FeverStarted ? 1 : 0),
        FeverBonus: (session.FeverBonus ?? 0) + fever.FeverBonus + fever.PerfectBonus,
        MaxCombo: Math.max(session.MaxCombo ?? 0, skill.Streak)
      } : {}
    });
    console.log(
      `[ProcessQuestionAnswer] ${playerID} q=${currentQuestionID} correct=${gradingResult.bIsCorrect} skill=${skill.SkillId} x${skill.Multiplier} ${skill.BaseScore}->${skill.Score} streak=${skill.Streak}` + (fever ? ` fever(ms=${answerMs}${scale !== 1 ? `/${scale}=${feverMs}` : ""} perfect=${fever.Perfect} slow=${fever.Slow} active=${fever.FeverActive} gauge=${fever.FeverGauge}${gaugeDrained !== void 0 ? ` drained=${gaugeDrained}` : ""} left=${fever.FeverLeft}${feverMsLeft !== void 0 ? ` msLeft=${feverMsLeft}` : ""} score=${fever.Score})` : "")
    );
    try {
      await recordAnswer(playerID, String(currentQuestionID), !!gradingResult.bIsCorrect);
    } catch (e) {
      console.error("[ProcessQuestionAnswer] question stats update failed:", e);
    }
    const processResult = await processQuizStep(scoredResult, playerID);
    const updatedSession = processResult.Session;
    let milk;
    if (processResult.Status === "COMPLETED") {
      try {
        const g = await grantQuizMilk(playerID);
        milk = { MilkGift: g.gift, QuizMilk: g.total, QuizMilkToday: g.today, QuizMilkCap: g.cap };
        console.log(`[ProcessQuestionAnswer] ${playerID} quiz milk +${g.gift} (total ${g.total}, today ${g.today}/${g.cap})`);
      } catch (e) {
        console.error("[ProcessQuestionAnswer] quiz milk failed:", e);
      }
    }
    return json(200, {
      Success: true,
      Status: processResult.Status,
      Result: scoredResult,
      Session: {
        QuestionCount: updatedSession.QuestionIDs.length,
        ...updatedSession,
        ...milk ?? {}
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
