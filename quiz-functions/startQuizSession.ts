import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  IdempotencyType,
  validateIdempotencyKey,
  createErrorResponse,
  createSuccessResponse,
  createIdempotentHandler,
} from 'quiz-utils/idempotencyUtils';
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { getShuffledQuestionIDs, type ShuffledQuizData } from 'quiz-utils/quizManager';
import { skillFor } from './characterSkills';
import { parseDifficulty, questionSetId, repeatFor, repeatQuestions } from './difficulty';

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

  // 난이도 모드 (difficulty.ts, 2026-11-17): 단 퀴즈(1~9)에 Difficulty 가 오면 그 난이도의 문제 묶음(211~519)에서 문제를 고른다.
  //   세션의 QuizID 는 단 그대로(1~9) — 이야기 · 단 정복 · 해금이 그대로 돌아가게. 옛 기기는 Difficulty 를 안 보내 예전 그대로.
  const difficulty = parseDifficulty(body.Difficulty);
  let setId = questionSetId(quizId, difficulty);
  console.log(`[Request] UserId: ${userId}, QuizId: ${quizId}${setId !== quizId ? ` difficulty=${difficulty} set=${setId}` : ''}`);

  // 3. 퀴즈 데이터 로드 (문제 순서 셔플 포함)
  let quizData: ShuffledQuizData;
  try {
    quizData = await getShuffledQuestionIDs(setId);
  } catch (error) {
    if (setId === quizId) {
      console.error('[StartQuizSession] Failed to load quiz data:', error);
      return createErrorResponse(404, `Quiz ${quizId} not found`);
    }
    // 난이도 묶음이 아직 S3 에 없으면 예전 단 퀴즈로 (배포 순서가 어긋나도 퀴즈는 시작되게)
    console.warn(`[StartQuizSession] set ${setId} not found, falling back to quiz ${quizId}:`, error);
    setId = quizId;
    try {
      quizData = await getShuffledQuestionIDs(quizId);
    } catch (error2) {
      console.error('[StartQuizSession] Failed to load quiz data:', error2);
      return createErrorResponse(404, `Quiz ${quizId} not found`);
    }
  }
  // QuizSize(매우 어려움 18문제): 레이어 버전과 상관없이 여기서도 자름 (이미 잘렸으면 그대로)
  const quizSize = (quizData as { QuizSize?: unknown }).QuizSize;
  const pickedIds = typeof quizSize === 'number' && quizSize > 0 ? quizData.QuestionIDs.slice(0, quizSize) : quizData.QuestionIDs;
  // 쉬움 · 보통 (9문제 묶음)은 문제마다 두 번 → 18문제 (difficulty.ts REPEAT, 2026-11-19). 묶음을 못 찾아 예전 단 퀴즈로 왔으면 그대로
  const questionIds = setId !== quizId ? repeatQuestions(pickedIds, repeatFor(difficulty)) : pickedIds;

  // 캐릭터 스킬(characterSkills.ts): 퀴즈를 시작할 때 고른 캐릭터를 세션에 적어 둔다.
  // 퀴즈 도중 메뉴에서 캐릭터를 바꿔도 이 판에는 영향이 없다. 읽기에 실패하면 스킬 없이(배율 1) 진행한다.
  let characterId: string | undefined;
  try {
    const player = await dynamoDBClient.send(
      new GetItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: userId }),
        ProjectionExpression: 'SelectedCharacterId',
      })
    );
    characterId = player.Item?.SelectedCharacterId?.S;
  } catch (error) {
    console.error('[StartQuizSession] Failed to read SelectedCharacterId, playing without skill:', error);
  }

  const now = new Date().toISOString();
  const nowMs = Date.now();
  const session = {
    CharacterId: characterId,
    SkillId: skillFor(characterId),
    Streak: 0,
    SkillBonus: 0,
    PlayerID: userId,
    QuizID: quizId,
    ...(setId !== quizId ? { Difficulty: difficulty, QuestionSetID: setId } : {}),
    QuestionIDs: questionIds,
    QuestionCount: questionIds.length,
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
