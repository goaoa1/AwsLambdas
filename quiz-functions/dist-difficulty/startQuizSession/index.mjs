// startQuizSession.ts
import {
  IdempotencyType,
  validateIdempotencyKey,
  createErrorResponse,
  createSuccessResponse,
  createIdempotentHandler
} from "quiz-utils/idempotencyUtils";
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { getShuffledQuestionIDs } from "quiz-utils/quizManager";

// characterSkills.ts
var SKILLS = {
  Char_001: "Steady",
  Char_002: "Focus",
  Char_003: "Lucky"
};
function skillFor(characterId) {
  return characterId && SKILLS[characterId] || "None";
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
function questionSetId(quizId, difficulty) {
  const n = Number(quizId);
  if (!difficulty || !Number.isInteger(n) || n < 1 || n > 9) return quizId;
  return String(DIFFICULTIES[difficulty].base + 10 + n);
}

// startQuizSession.ts
var dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
var PLAYER_TABLE = "PlayerResources";
var SESSIONS_TABLE = "ActiveQuizSessions";
var STAMINA_COST = 1;
var lambdaHandler = async (event, _context) => {
  console.log("[StartQuizSession] Lambda invoked");
  const validation = validateIdempotencyKey(event, IdempotencyType.SESSION_START);
  if (!validation.isValid) {
    return createErrorResponse(400, validation.error);
  }
  const userId = validation.userId;
  if (!event.body) {
    return createErrorResponse(400, "Missing request body");
  }
  const body = JSON.parse(event.body);
  const quizId = body.QuizID;
  if (!quizId) {
    return createErrorResponse(400, "Missing QuizID");
  }
  const difficulty = parseDifficulty(body.Difficulty);
  let setId = questionSetId(quizId, difficulty);
  console.log(`[Request] UserId: ${userId}, QuizId: ${quizId}${setId !== quizId ? ` difficulty=${difficulty} set=${setId}` : ""}`);
  let quizData;
  try {
    quizData = await getShuffledQuestionIDs(setId);
  } catch (error) {
    if (setId === quizId) {
      console.error("[StartQuizSession] Failed to load quiz data:", error);
      return createErrorResponse(404, `Quiz ${quizId} not found`);
    }
    console.warn(`[StartQuizSession] set ${setId} not found, falling back to quiz ${quizId}:`, error);
    setId = quizId;
    try {
      quizData = await getShuffledQuestionIDs(quizId);
    } catch (error2) {
      console.error("[StartQuizSession] Failed to load quiz data:", error2);
      return createErrorResponse(404, `Quiz ${quizId} not found`);
    }
  }
  const quizSize = quizData.QuizSize;
  const questionIds = typeof quizSize === "number" && quizSize > 0 ? quizData.QuestionIDs.slice(0, quizSize) : quizData.QuestionIDs;
  let characterId;
  try {
    const player = await dynamoDBClient.send(
      new GetItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: userId }),
        ProjectionExpression: "SelectedCharacterId"
      })
    );
    characterId = player.Item?.SelectedCharacterId?.S;
  } catch (error) {
    console.error("[StartQuizSession] Failed to read SelectedCharacterId, playing without skill:", error);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const nowMs = Date.now();
  const session = {
    CharacterId: characterId,
    SkillId: skillFor(characterId),
    Streak: 0,
    SkillBonus: 0,
    PlayerID: userId,
    QuizID: quizId,
    ...setId !== quizId ? { Difficulty: difficulty, QuestionSetID: setId } : {},
    QuestionIDs: questionIds,
    QuestionCount: questionIds.length,
    CurrentQuestionIndex: 0,
    Score: 0,
    StartTime: nowMs,
    AccumulatedPlayTime: 0,
    LastResumeTime: nowMs,
    IsPaused: false,
    CreatedAt: now,
    UpdatedAt: now
  };
  try {
    await dynamoDBClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: PLAYER_TABLE,
              Key: marshall({ PlayerID: userId }),
              UpdateExpression: "SET Stamina = Stamina - :cost, UpdatedAt = :now, LastStaminaUpdateAt = if_not_exists(LastStaminaUpdateAt, :nowMs)",
              ConditionExpression: "attribute_exists(PlayerID) AND Stamina >= :cost",
              ExpressionAttributeValues: marshall({ ":cost": STAMINA_COST, ":now": now, ":nowMs": nowMs })
            }
          },
          {
            Put: {
              TableName: SESSIONS_TABLE,
              Item: marshall(session, { removeUndefinedValues: true })
            }
          }
        ]
      })
    );
  } catch (error) {
    const err = error;
    if (err.name === "TransactionCanceledException" && err.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed") {
      console.warn(`[StartQuizSession] Insufficient stamina for player ${userId}`);
      return createErrorResponse(409, "Insufficient stamina");
    }
    console.error("[StartQuizSession] Transaction error:", error);
    throw error;
  }
  console.log(`[StartQuizSession] Session created for player ${userId}, quiz ${quizId}`);
  return createSuccessResponse({ Session: session });
};
var handler = createIdempotentHandler(lambdaHandler, IdempotencyType.SESSION_START);
export {
  handler
};
