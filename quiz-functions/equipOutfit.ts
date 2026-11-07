// ========================================
// equipOutfit.ts - 보유 의상을 캐릭터에 입히기 / 벗기기 (부위별)
//   POST /equip-outfit
//     { CharacterId, OutfitId }                   입히기. 같은 부위(상의/하의, 세트는 둘 다)의 의상은 벗겨진다
//     { CharacterId, OutfitId, Unequip: true }    그 의상만 벗기기
//     { CharacterId, OutfitId: '' }               그 캐릭터의 의상 전부 벗기기 (부위가 나뉘기 전 클라이언트 호환)
//   403: 보유하지 않은 의상, 400: 그 캐릭터가 입을 수 없는 의상
//   EquippedOutfits 키는 "Char_003#Top" 형식. 옛 키 "Char_003" 는 다음 변경 때 부위 키로 옮겨진다
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { equipInMap, findOutfit, outfitFitsCharacter, unequipInMap } from './shopCatalog';
import { readShopState } from './shopState';

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const PLAYER_TABLE = 'PlayerResources';
const CHARACTER_ID_PATTERN = /^[A-Za-z0-9_]{1,32}$/;

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
  let unequip = false;
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    characterId = body.CharacterId;
    outfitId = body.OutfitId ?? '';
    unequip = body.Unequip === true;
  } catch {
    return createErrorResponse(400, 'Invalid request body');
  }

  if (typeof characterId !== 'string' || !CHARACTER_ID_PATTERN.test(characterId)) {
    return createErrorResponse(400, 'CharacterId is required');
  }
  if (typeof outfitId !== 'string') {
    return createErrorResponse(400, 'OutfitId must be a string');
  }

  const isUnequip = unequip || outfitId.length === 0;
  if (!isUnequip) {
    const outfit = findOutfit(outfitId);
    if (!outfit) {
      return createErrorResponse(404, 'Unknown outfit');
    }
    if (!outfitFitsCharacter(outfit, characterId)) {
      return createErrorResponse(400, 'This character cannot wear that outfit', { Reason: 'NotCompatible' });
    }
  }

  // 현재 보유·착용 상태
  const getResult = await dynamoDBClient.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      ProjectionExpression: 'OwnedOutfits, EquippedOutfits',
    })
  );
  const current = readShopState(getResult.Item ? unmarshall(getResult.Item) : undefined);

  if (!isUnequip && !current.OwnedOutfits.includes(outfitId)) {
    return createErrorResponse(403, 'Outfit not owned', { Reason: 'NotOwned' });
  }

  const next = isUnequip
    ? unequipInMap(current.EquippedOutfits, characterId, outfitId)
    : equipInMap(current.EquippedOutfits, characterId, outfitId);

  // 맵 전체를 바꿔 쓴다. 입히기는 그 사이에 보유가 사라지지 않았는지 다시 확인
  const now = new Date().toISOString();
  const result = await dynamoDBClient.send(
    new UpdateItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      UpdateExpression: 'SET EquippedOutfits = :map, UpdatedAt = :now',
      ...(isUnequip ? {} : { ConditionExpression: 'contains(OwnedOutfits, :oid)' }),
      ExpressionAttributeValues: marshall(
        isUnequip ? { ':map': next, ':now': now } : { ':map': next, ':now': now, ':oid': outfitId },
        { removeUndefinedValues: true }
      ),
      ReturnValues: 'ALL_NEW',
    })
  );

  const state = readShopState(unmarshall(result.Attributes!));
  console.log(`[EquipOutfit] Player ${userId} ${isUnequip ? 'unequipped' : 'equipped'} ${outfitId || '(all)'} on ${characterId}`);

  return createSuccessResponse({
    CharacterId: characterId,
    OutfitId: isUnequip ? '' : outfitId,
    EquippedOutfits: state.EquippedOutfits,
  });
};
