import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const PLAYER_TABLE = 'PlayerResources';
const INITIAL_STAMINA = 10;

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

  // if_not_exists: 이미 값이 있으면 덮어쓰지 않음 → 재로그인 시 안전
  const result = await dynamoDBClient.send(
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
        ':now':         now,
      }),
      ReturnValues: 'ALL_NEW',
    })
  );

  const playerData = unmarshall(result.Attributes!);
  console.log(`[RecordPlayerInfo] Player ${userId} ready. Stamina: ${playerData.Stamina}`);

  return createSuccessResponse({
    PlayerID: playerData.PlayerID,
    Stamina:  playerData.Stamina,
    CreatedAt: playerData.CreatedAt,
  });
};
