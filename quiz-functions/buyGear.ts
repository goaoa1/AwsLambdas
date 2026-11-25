// ========================================
// buyGear.ts - POST /buy-gear { ItemId } (장비 · 스킬 G1, 2026-11-25 — 상점 '장비' 탭)
//   크레딧으로 장비 하나를 산다. 장비마다 최대 4개(캐릭터 수). 전투에서만 나오는 것(Price 0)은 팔지 않는다.
//   UpdateItem 하나로: Credits - 가격 (조건: 크레딧 충분), Items.#id 설정 (조건: 읽은 개수 그대로)
//   오류 Reason: UnknownItem / NotForSale / NotEnoughCredits / TooMany / Conflict
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId, parseBody } from './friendStore';
import { MAX_GEAR_COUNT, findGear } from './gearCatalog';
import { PLAYER_TABLE, readPlayerGear, toClientGear } from './gearStore';
import { ensureItemsMap } from './inventoryStore';

const client = new DynamoDBClient({ region: process.env.REGION });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const gear = findGear(parseBody<{ ItemId?: string }>(event.body)?.ItemId);
  if (!gear) return createErrorResponse(400, 'Unknown item', { Reason: 'UnknownItem' });
  if (gear.Price <= 0) return createErrorResponse(400, 'Not for sale', { Reason: 'NotForSale' });

  try {
    await ensureItemsMap(me);
    const row = await readPlayerGear(me);
    if (!row.Exists) return createErrorResponse(404, 'Player not found', { Reason: 'NoPlayer' });
    if (row.Credits < gear.Price) return createErrorResponse(409, 'Not enough credits', { Reason: 'NotEnoughCredits' });
    const cur = row.Items[gear.ItemId] ?? 0;
    if (cur + 1 > MAX_GEAR_COUNT) return createErrorResponse(409, 'Too many', { Reason: 'TooMany' });
    try {
      await client.send(
        new UpdateItemCommand({
          TableName: PLAYER_TABLE,
          Key: marshall({ PlayerID: me }),
          UpdateExpression: 'SET Credits = Credits - :cost, #items.#id = :next, UpdatedAt = :now',
          ConditionExpression: 'Credits >= :cost AND (attribute_not_exists(#items.#id) OR #items.#id = :cur)',
          ExpressionAttributeNames: { '#items': 'Items', '#id': gear.ItemId },
          ExpressionAttributeValues: marshall({ ':cost': gear.Price, ':next': cur + 1, ':cur': cur, ':now': new Date().toISOString() }),
        })
      );
    } catch (e) {
      if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return createErrorResponse(409, 'Try again', { Reason: 'Conflict' });
      throw e;
    }
    console.log(`[BuyGear] ${me} ${gear.ItemId} ${cur} -> ${cur + 1} for ${gear.Price}`);
    return createSuccessResponse({ Bought: { ItemId: gear.ItemId, Name: gear.Name, Cost: gear.Price }, ...toClientGear(await readPlayerGear(me)) });
  } catch (e) {
    console.error('[BuyGear]', e);
    return createErrorResponse(500, 'Failed to buy');
  }
};
