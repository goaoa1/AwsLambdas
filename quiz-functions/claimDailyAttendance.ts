import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  IdempotencyType,
  validateIdempotencyKey,
  createErrorResponse,
  createSuccessResponse,
  createIdempotentHandler,
} from 'quiz-utils/idempotencyUtils';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ensureItemsMap, grantItemsExpression } from './inventoryStore';
import { ITEM_NAME } from './itemCatalog';

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const PLAYER_TABLE = 'PlayerResources';
const MAX_STAMINA = 10;

function getKSTDateString(offsetDays = 0): string {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const dayOffsetMs = offsetDays * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + kstOffsetMs + dayOffsetMs).toISOString().slice(0, 10);
}

// 아이템 인벤토리 1단계: 연속 출석 보너스 아이템 (7일 주기로 3일째 작은 물약, 7일째 큰 물약)
function calcBonusItems(streak: number): Record<string, number> {
  if (streak % 7 === 0) return { Item_StaminaL: 1 };
  if (streak % 7 === 3) return { Item_StaminaS: 1 };
  return {};
}

function calcReward(streak: number): number {
  if (streak % 7 === 0) return 5;
  if (streak % 3 === 0) return 2;
  return 1;
}

const lambdaHandler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('[ClaimDailyAttendance] Lambda invoked');

  const validation = validateIdempotencyKey(event, IdempotencyType.ATTENDANCE_CHECK);
  if (!validation.isValid) {
    return createErrorResponse(400, validation.error!);
  }
  const userId = validation.userId!;

  const todayKST = getKSTDateString(0);
  const yesterdayKST = getKSTDateString(-1);

  // 보너스 아이템을 Items.#id 로 넣으려면 맵이 먼저 있어야 한다
  await ensureItemsMap(userId);

  // 1. 현재 플레이어 데이터 읽기
  const getResult = await dynamoDBClient.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
    })
  );

  if (!getResult.Item) {
    return createErrorResponse(404, 'Player not found');
  }

  const playerData = unmarshall(getResult.Item);
  const lastAttendanceDate: string | undefined = playerData.LastAttendanceDate;
  const currentStreak: number = playerData.AttendanceStreak ?? 0;
  const currentTotal: number = playerData.TotalAttendanceDays ?? 0;
  const currentStamina: number = playerData.Stamina ?? 0;

  // 2. 오늘 이미 수령했으면 409
  if (lastAttendanceDate === todayKST) {
    return createErrorResponse(409, 'Already claimed today');
  }

  // 3. 스트릭 계산 (어제 출석 → 연속, 그 외 → 초기화)
  const newStreak = lastAttendanceDate === yesterdayKST ? currentStreak + 1 : 1;
  const newTotal = currentTotal + 1;
  const reward = calcReward(newStreak);
  const newStamina = Math.min(currentStamina + reward, MAX_STAMINA);
  const isFull = newStamina >= MAX_STAMINA;
  const now = new Date().toISOString();

  const currentItems: Record<string, number> = {};
  for (const [k, v] of Object.entries((playerData.Items as Record<string, unknown>) ?? {})) currentItems[k] = Number(v) || 0;
  const bonus = grantItemsExpression(calcBonusItems(newStreak), currentItems, 'b');

  // 4. 원자적 업데이트 (condition으로 경쟁 조건에서도 중복 방지)
  const baseSet = 'SET LastAttendanceDate = :today, AttendanceStreak = :newStreak, TotalAttendanceDays = :newTotal, Stamina = :newStamina, UpdatedAt = :now'
    + (bonus.sets.length ? ', ' + bonus.sets.join(', ') : '');
  const updateExpression = isFull ? baseSet + ' REMOVE LastStaminaUpdateAt' : baseSet;

  try {
    await dynamoDBClient.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: userId }),
        UpdateExpression: updateExpression,
        ConditionExpression:
          '(attribute_not_exists(LastAttendanceDate) OR LastAttendanceDate <> :today)' +
          (bonus.conds.length ? ' AND ' + bonus.conds.join(' AND ') : ''),
        ...(Object.keys(bonus.names).length ? { ExpressionAttributeNames: bonus.names } : {}),
        ExpressionAttributeValues: marshall({
          ':today': todayKST,
          ':newStreak': newStreak,
          ':newTotal': newTotal,
          ':newStamina': newStamina,
          ':now': now,
          ...bonus.values,
        }),
      })
    );
  } catch (error: unknown) {
    const err = error as { name?: string };
    if (err.name === 'ConditionalCheckFailedException') {
      return createErrorResponse(409, 'Already claimed today');
    }
    console.error('[ClaimDailyAttendance] Update error:', error);
    throw error;
  }

  console.log(
    `[ClaimDailyAttendance] Player ${userId} claimed. Reward: +${reward}, Streak: ${newStreak}, Total: ${newTotal}`
  );

  return createSuccessResponse({
    Reward: reward,
    NewStreak: newStreak,
    TotalDays: newTotal,
    UpdatedStamina: newStamina,
    // 보너스 아이템 [{ ItemId, Name, Count }]
    BonusItems: Object.entries(bonus.granted).map(([ItemId, Count]) => ({ ItemId, Name: ITEM_NAME(ItemId), Count })),
  });
};

export const handler = createIdempotentHandler(lambdaHandler, IdempotencyType.ATTENDANCE_CHECK);
