import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const PLAYER_TABLE = 'PlayerResources';
const INITIAL_STAMINA = 10;
const MAX_STAMINA = 10;
const REGEN_INTERVAL_MS = 10 * 60 * 1000; // 10분마다 1씩 회복

export const handler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('[RecordPlayerInfo] Lambda invoked');

  const userId = event.requestContext?.authorizer?.claims?.sub as string | undefined;
  if (!userId) {
    return createErrorResponse(401, 'Unauthorized');
  }

  const now = new Date().toISOString();
  const nowMs = Date.now();

  // 1. 신규 플레이어 등록 (기존 값은 if_not_exists로 보존) + 현재 데이터 조회
  const upsertResult = await dynamoDBClient.send(
    new UpdateItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      UpdateExpression: `
        SET Stamina   = if_not_exists(Stamina,   :initStamina),
            CreatedAt = if_not_exists(CreatedAt, :now),
            UpdatedAt = :now
      `,
      ExpressionAttributeValues: marshall({
        ':initStamina': INITIAL_STAMINA,
        ':now': now,
      }),
      ReturnValues: 'ALL_NEW',
    })
  );

  const playerData = unmarshall(upsertResult.Attributes!);
  let stamina: number = playerData.Stamina;
  let lastStaminaUpdateAt: number | undefined = playerData.LastStaminaUpdateAt;

  // 2. 스테미나 재생 계산 (스테미나가 가득 차지 않았고 클락이 존재할 때)
  if (stamina < MAX_STAMINA && lastStaminaUpdateAt != null) {
    const elapsed = nowMs - lastStaminaUpdateAt;
    const regenCount = Math.floor(elapsed / REGEN_INTERVAL_MS);

    if (regenCount > 0) {
      const newStamina = Math.min(stamina + regenCount, MAX_STAMINA);
      const advancedLastUpdate = lastStaminaUpdateAt + regenCount * REGEN_INTERVAL_MS;

      if (newStamina >= MAX_STAMINA) {
        // 스테미나 가득: 재생 클락 제거
        await dynamoDBClient.send(
          new UpdateItemCommand({
            TableName: PLAYER_TABLE,
            Key: marshall({ PlayerID: userId }),
            UpdateExpression: 'SET Stamina = :stamina, UpdatedAt = :now REMOVE LastStaminaUpdateAt',
            ExpressionAttributeValues: marshall({ ':stamina': newStamina, ':now': now }),
          })
        );
        lastStaminaUpdateAt = undefined;
      } else {
        // 일부 재생: 클락을 재생된 만큼 전진
        await dynamoDBClient.send(
          new UpdateItemCommand({
            TableName: PLAYER_TABLE,
            Key: marshall({ PlayerID: userId }),
            UpdateExpression: 'SET Stamina = :stamina, LastStaminaUpdateAt = :lastUpdate, UpdatedAt = :now',
            ExpressionAttributeValues: marshall({
              ':stamina': newStamina,
              ':lastUpdate': advancedLastUpdate,
              ':now': now,
            }),
          })
        );
        lastStaminaUpdateAt = advancedLastUpdate;
      }

      stamina = newStamina;
      console.log(`[RecordPlayerInfo] Regen: +${regenCount} → Stamina ${stamina}/${MAX_STAMINA}`);
    }
  }

  // 3. NextRegenAt 계산 (스테미나가 부족할 때만 의미 있음)
  const nextRegenAt =
    stamina < MAX_STAMINA && lastStaminaUpdateAt != null
      ? new Date(lastStaminaUpdateAt + REGEN_INTERVAL_MS).toISOString()
      : '';

  console.log(`[RecordPlayerInfo] Player ${userId} Stamina: ${stamina}/${MAX_STAMINA}, NextRegenAt: ${nextRegenAt}`);

  return createSuccessResponse({
    PlayerID:    playerData.PlayerID,
    Stamina:     stamina,
    MaxStamina:  MAX_STAMINA,
    NextRegenAt: nextRegenAt,
    CreatedAt:   playerData.CreatedAt,
  });
};
