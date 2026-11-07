// ========================================
// equipOutfit.ts - 보유 의상을 캐릭터에 입히기 / 벗기기
//   POST /equip-outfit  { CharacterId, OutfitId }   OutfitId 가 빈 문자열이면 벗기기
//   403: 보유하지 않은 의상, 400: 그 캐릭터가 입을 수 없는 의상
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { findOutfit, outfitFitsCharacter } from './shopCatalog';
import { readShopState } from './shopState';

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const PLAYER_TABLE = 'PlayerResources';
const CHARACTER_ID_PATTERN = /^[A-Za-z0-9_]{1,32}$/;

async function ensureEquippedMap(userId: string): Promise<void> {
  await dynamoDBClient.send(
    new UpdateItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      UpdateExpression: 'SET EquippedOutfits = if_not_exists(EquippedOutfits, :empty)',
      ExpressionAttributeValues: marshall({ ':empty': {} }),
    })
  );
}

export const handler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('[EquipOutfit] Lambda invoked');

  const userId = event.requestContext?.authorizer?.claims?.sub as string | undefined;
  if (!userId) {
    return createErrorResponse(401, 'Unauthorized');
  }

  let characterId: unknown;
  let outfitId: unknown;
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    characterId = body.CharacterId;
    outfitId = body.OutfitId ?? '';
  } catch {
    return createErrorResponse(400, 'Invalid request body');
  }

  if (typeof characterId !== 'string' || !CHARACTER_ID_PATTERN.test(characterId)) {
    return createErrorResponse(400, 'CharacterId is required');
  }
  if (typeof outfitId !== 'string') {
    return createErrorResponse(400, 'OutfitId must be a string');
  }

  const now = new Date().toISOString();

  if (outfitId.length === 0) {
    // 벗기기: 맵이 없으면 먼저 만들고(중첩 경로 REMOVE 는 맵이 있어야 한다) 해당 캐릭터 항목을 제거
    await ensureEquippedMap(userId);
    const removed = await dynamoDBClient.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: userId }),
        UpdateExpression: 'REMOVE EquippedOutfits.#cid SET UpdatedAt = :now',
        ExpressionAttributeNames: { '#cid': characterId },
        ExpressionAttributeValues: marshall({ ':now': now }),
        ReturnValues: 'ALL_NEW',
      })
    );
    const state = readShopState(unmarshall(removed.Attributes!));
    console.log(`[EquipOutfit] Player ${userId} unequipped ${characterId}`);
    return createSuccessResponse({ CharacterId: characterId, OutfitId: '', EquippedOutfits: state.EquippedOutfits });
  }

  const outfit = findOutfit(outfitId);
  if (!outfit) {
    return createErrorResponse(404, 'Unknown outfit');
  }
  if (!outfitFitsCharacter(outfit, characterId)) {
    return createErrorResponse(400, 'This character cannot wear that outfit', { Reason: 'NotCompatible' });
  }

  // 보유 확인
  const getResult = await dynamoDBClient.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      ProjectionExpression: 'OwnedOutfits',
    })
  );
  const owned = readShopState(getResult.Item ? unmarshall(getResult.Item) : undefined).OwnedOutfits;
  if (!owned.includes(outfitId)) {
    return createErrorResponse(403, 'Outfit not owned', { Reason: 'NotOwned' });
  }

  // 맵이 없으면 만들고 나서 항목을 넣는다 (두 단계: 중첩 경로 SET 은 맵이 있어야 한다)
  await ensureEquippedMap(userId);
  const result = await dynamoDBClient.send(
    new UpdateItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      UpdateExpression: 'SET EquippedOutfits.#cid = :oid, UpdatedAt = :now',
      ConditionExpression: 'contains(OwnedOutfits, :oid)',
      ExpressionAttributeNames: { '#cid': characterId },
      ExpressionAttributeValues: marshall({ ':oid': outfitId, ':now': now }),
      ReturnValues: 'ALL_NEW',
    })
  );

  const state = readShopState(unmarshall(result.Attributes!));
  console.log(`[EquipOutfit] Player ${userId} equipped ${outfitId} on ${characterId}`);

  return createSuccessResponse({
    CharacterId: characterId,
    OutfitId: outfitId,
    EquippedOutfits: state.EquippedOutfits,
  });
};
