// ========================================
// purchaseOutfit.ts - 크레딧으로 의상 구매
//   POST /purchase-outfit  { OutfitId }
//   헤더 X-Idempotency-Key / X-Idempotency-Timestamp 필요 (ITEM_PURCHASE)
//   409: 크레딧 부족 / 이미 보유
// ========================================

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
import { findOutfit } from './shopCatalog';
import { readShopState } from './shopState';

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const PLAYER_TABLE = 'PlayerResources';

const lambdaHandler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('[PurchaseOutfit] Lambda invoked');

  const validation = validateIdempotencyKey(event, IdempotencyType.ITEM_PURCHASE);
  if (!validation.isValid) {
    return createErrorResponse(400, validation.error!);
  }
  const userId = validation.userId!;

  let outfitId: unknown;
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    outfitId = body.OutfitId;
  } catch {
    return createErrorResponse(400, 'Invalid request body');
  }
  if (!outfitId || typeof outfitId !== 'string') {
    return createErrorResponse(400, 'OutfitId is required');
  }

  const outfit = findOutfit(outfitId);
  if (!outfit) {
    return createErrorResponse(404, 'Unknown outfit');
  }

  // 1. 현재 상태 확인 (이미 보유했으면 409)
  const getResult = await dynamoDBClient.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      ProjectionExpression: 'Credits, OwnedOutfits',
    })
  );
  if (!getResult.Item) {
    return createErrorResponse(404, 'Player not found');
  }
  const state = readShopState(unmarshall(getResult.Item));

  if (state.OwnedOutfits.includes(outfitId)) {
    return createErrorResponse(409, 'Already owned', { Reason: 'AlreadyOwned', Credits: state.Credits });
  }
  if (state.Credits < outfit.Price) {
    return createErrorResponse(409, 'Insufficient credits', {
      Reason: 'InsufficientCredits',
      Credits: state.Credits,
      Price: outfit.Price,
    });
  }

  // 2. 원자적 차감 + 보유 목록 추가 (경쟁 조건에서도 이중 차감 방지)
  const now = new Date().toISOString();
  try {
    const result = await dynamoDBClient.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: userId }),
        UpdateExpression:
          'SET Credits = Credits - :price, OwnedOutfits = list_append(if_not_exists(OwnedOutfits, :empty), :newItem), UpdatedAt = :now',
        ConditionExpression: 'Credits >= :price AND (attribute_not_exists(OwnedOutfits) OR NOT contains(OwnedOutfits, :outfitId))',
        ExpressionAttributeValues: marshall({
          ':price': outfit.Price,
          ':empty': [],
          ':newItem': [outfitId],
          ':outfitId': outfitId,
          ':now': now,
        }),
        ReturnValues: 'ALL_NEW',
      })
    );

    const updated = readShopState(unmarshall(result.Attributes!));
    console.log(`[PurchaseOutfit] Player ${userId} bought ${outfitId} for ${outfit.Price}. Credits ${state.Credits} -> ${updated.Credits}`);

    return createSuccessResponse({
      OutfitId: outfitId,
      Price: outfit.Price,
      Credits: updated.Credits,
      OwnedOutfits: updated.OwnedOutfits,
    });
  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return createErrorResponse(409, 'Purchase rejected', { Reason: 'Conflict' });
    }
    console.error('[PurchaseOutfit] Update error:', error);
    throw error;
  }
};

export const handler = createIdempotentHandler(lambdaHandler, IdempotencyType.ITEM_PURCHASE);
