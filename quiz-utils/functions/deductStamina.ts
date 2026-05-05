// ========================================
// functions/deductStamina/index.ts
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  IdempotencyType,
  validateIdempotencyKey,
  createErrorResponse,
  createSuccessResponse,
  createIdempotentHandler,
} from 'quiz-utils/idempotencyUtils';
import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const PLAYER_TABLE = 'PlayerResources';

// ========================================
// 스태미나 차감
// ========================================
async function deductStamina(userId: string, amount: number): Promise<boolean> {
  try {
    const getResult = await dynamoDBClient.send(
      new GetItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: userId }),
      })
    );

    if (!getResult.Item) {
      console.error('[DeductStamina] Player not found');
      return false;
    }

    const playerData = unmarshall(getResult.Item);
    const currentStamina = playerData.Stamina || 0;

    if (currentStamina < amount) {
      console.error(`[DeductStamina] Insufficient stamina: ${currentStamina} < ${amount}`);
      return false;
    }

    await dynamoDBClient.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: userId }),
        UpdateExpression: 'SET Stamina = Stamina - :amount, UpdatedAt = :now',
        ConditionExpression: 'Stamina >= :amount',
        ExpressionAttributeValues: marshall({
          ':amount': amount,
          ':now': new Date().toISOString(),
        }),
      })
    );

    console.log(`[DeductStamina] Success: ${currentStamina} -> ${currentStamina - amount}`);
    return true;

  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      console.error('[DeductStamina] Race condition - insufficient stamina');
      return false;
    }
    throw error;
  }
}

// ========================================
// 현재 스태미나 조회
// ========================================
async function getCurrentStamina(userId: string): Promise<number> {
  const result = await dynamoDBClient.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
    })
  );

  if (!result.Item) return 0;

  const playerData = unmarshall(result.Item);
  return playerData.Stamina || 0;
}

// ========================================
// Lambda Handler
// ========================================
const lambdaHandler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('[DeductStamina] Lambda invoked');

  // 1. Idempotency Key 검증
  const validation = validateIdempotencyKey(event, IdempotencyType.STAMINA_DEDUCT);
  if (!validation.isValid) {
    return createErrorResponse(400, validation.error!);
  }

  const userId = validation.userId!;

  // 2. 요청 본문 파싱
  if (!event.body) {
    return createErrorResponse(400, 'Missing request body');
  }

  const body = JSON.parse(event.body);
  const amount = body.Amount || 1;

  if (amount <= 0 || amount > 100) {
    return createErrorResponse(400, 'Invalid amount. Must be 1-100');
  }

  console.log(`[Request] UserId: ${userId}, Amount: ${amount}`);

  // 3. 스태미나 차감
  const success = await deductStamina(userId, amount);
  if (!success) {
    return createErrorResponse(409, 'Insufficient stamina');
  }

  // 4. 현재 스태미나 조회
  const remainingStamina = await getCurrentStamina(userId);

  return createSuccessResponse({
    Message: 'Stamina deducted successfully',
    RemainingStamina: remainingStamina,
    DeductedAmount: amount,
  });
};

// ========================================
// middy + 멱등성 미들웨어는 Layer의 createIdempotentHandler가 처리
// ========================================
export const handler = createIdempotentHandler(lambdaHandler, IdempotencyType.STAMINA_DEDUCT);
