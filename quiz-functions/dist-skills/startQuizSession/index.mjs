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
  console.log(`[Request] UserId: ${userId}, QuizId: ${quizId}`);
  let quizData;
  try {
    quizData = await getShuffledQuestionIDs(quizId);
  } catch (error) {
    console.error("[StartQuizSession] Failed to load quiz data:", error);
    return createErrorResponse(404, `Quiz ${quizId} not found`);
  }
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
    QuestionIDs: quizData.QuestionIDs,
    QuestionCount: quizData.QuestionIDs.length,
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
