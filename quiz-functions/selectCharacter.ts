import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const PLAYER_TABLE = 'PlayerResources';

export const handler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('[SelectCharacter] Lambda invoked');

  const userId = event.requestContext?.authorizer?.claims?.sub as string | undefined;
  if (!userId) {
    return createErrorResponse(401, 'Unauthorized');
  }

  let characterId: unknown;
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    characterId = body.CharacterId;
  } catch {
    return createErrorResponse(400, 'Invalid request body');
  }

  if (!characterId || typeof characterId !== 'string') {
    return createErrorResponse(400, 'CharacterId is required');
  }

  const now = new Date().toISOString();

  const result = await dynamoDBClient.send(
    new UpdateItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      UpdateExpression: 'SET SelectedCharacterId = :cid, UpdatedAt = :now',
      ExpressionAttributeValues: marshall({ ':cid': characterId, ':now': now }),
      ReturnValues: 'ALL_NEW',
    })
  );

  const playerData = unmarshall(result.Attributes!);
  console.log(`[SelectCharacter] Player ${userId} selected ${characterId}`);

  return createSuccessResponse({
    SelectedCharacterId: playerData.SelectedCharacterId,
  });
};
