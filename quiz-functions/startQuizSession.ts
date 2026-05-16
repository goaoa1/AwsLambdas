import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  IdempotencyType,
  validateIdempotencyKey,
  createErrorResponse,
  createSuccessResponse,
  createIdempotentHandler,
} from 'quiz-utils/idempotencyUtils';
import { DynamoDBClient, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { getShuffledQuestionIDs, type ShuffledQuizData } from 'quiz-utils/quizManager';

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const PLAYER_TABLE = 'PlayerResources';
const SESSIONS_TABLE = 'ActiveQuizSessions';
const STAMINA_COST = 1;

const lambdaHandler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('[StartQuizSession] Lambda invoked');

  // 1. Idempotency Key 검증
  const validation = validateIdempotencyKey(event, IdempotencyType.SESSION_START);
  if (!validation.isValid) {
    return createErrorResponse(400, validation.error!);
  }
  const userId = validation.userId!;

  // 2. 요청 본문 파싱
  if (!event.body) {
    return createErrorResponse(400, 'Missing request body');
  }
  const body = JSON.parse(event.body);
  const quizId: string = body.QuizID;
  if (!quizId) {
    return createErrorResponse(400, 'Missing QuizID');
  }

  console.log(`[Request] UserId: ${userId}, QuizId: ${quizId}`);

  // 3. 퀴즈 데이터 로드 (문제 순서 셔플 포함)
  let quizData: ShuffledQuizData;
  try {
    quizData = await getShuffledQuestionIDs(quizId);
  } catch (error) {
    console.error('[StartQuizSession] Failed to load quiz data:', error);
    return createErrorResponse(404, `Quiz ${quizId} not found`);
  }

  const now = new Date().toISOString();
  const nowMs = Date.now();
  const session = {
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
    UpdatedAt: now,
  };

  // 4. 스테미나 차감 + 세션 생성을 하나의 트랜잭션으로 처리
  //    스테미나가 부족하면 ConditionalCheckFailed → 세션도 생성되지 않음
  try {
    await dynamoDBClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: PLAYER_TABLE,
              Key: marshall({ PlayerID: userId }),
              UpdateExpression: 'SET Stamina = Stamina - :cost, UpdatedAt = :now, LastStaminaUpdateAt = if_not_exists(LastStaminaUpdateAt, :nowMs)',
              ConditionExpression: 'attribute_exists(PlayerID) AND Stamina >= :cost',
              ExpressionAttributeValues: marshall({ ':cost': STAMINA_COST, ':now': now, ':nowMs': nowMs }),
            },
          },
          {
            Put: {
              TableName: SESSIONS_TABLE,
              Item: marshall(session, { removeUndefinedValues: true }),
            },
          },
        ],
      })
    );
  } catch (error: unknown) {
    const err = error as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
    if (
      err.name === 'TransactionCanceledException' &&
      err.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed'
    ) {
      console.warn(`[StartQuizSession] Insufficient stamina for player ${userId}`);
      return createErrorResponse(409, 'Insufficient stamina');
    }
    console.error('[StartQuizSession] Transaction error:', error);
    throw error;
  }

  console.log(`[StartQuizSession] Session created for player ${userId}, quiz ${quizId}`);
  return createSuccessResponse({ Session: session });
};

export const handler = createIdempotentHandler(lambdaHandler, IdempotencyType.SESSION_START);
