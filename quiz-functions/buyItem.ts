// ========================================
// buyItem.ts - POST /buy-item { ItemId, Count? (1~10) }
//   크레딧으로 아이템을 산다. UpdateItem 하나로: Credits - 가격×수 (조건: 크레딧 충분), Items.#id 설정 (조건: 읽은 개수 그대로)
//   아이템마다 최대 99 개. 넘치게는 살 수 없다.
//   오류 Reason: UnknownItem / NotForSale / BadCount / NotEnoughCredits / TooMany / Conflict
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId, parseBody } from './friendStore';
import { MAX_BUY_COUNT, MAX_ITEM_COUNT, findItem } from './itemCatalog';
import { PLAYER_TABLE, ensureItemsMap, readPlayerItems, toClientInventory } from './inventoryStore';

const client = new DynamoDBClient({ region: process.env.REGION });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const body = parseBody<{ ItemId?: string; Count?: number }>(event.body);
  const item = findItem(body?.ItemId);
  if (!item) return createErrorResponse(400, 'Unknown item', { Reason: 'UnknownItem' });
  if (item.Price <= 0) return createErrorResponse(400, 'Not for sale', { Reason: 'NotForSale' });
  const count = Math.floor(Number(body?.Count ?? 1));
  if (!(count >= 1 && count <= MAX_BUY_COUNT)) return createErrorResponse(400, 'Bad count', { Reason: 'BadCount' });

  await ensureItemsMap(me);
  const row = await readPlayerItems(me);
  if (!row.Exists) return createErrorResponse(404, 'Player not found', { Reason: 'NoPlayer' });
  const cost = item.Price * count;
  if (row.Credits < cost) return createErrorResponse(409, 'Not enough credits', { Reason: 'NotEnoughCredits' });
  const cur = row.Items[item.ItemId] ?? 0;
  if (cur + count > MAX_ITEM_COUNT) return createErrorResponse(409, 'Too many', { Reason: 'TooMany' });

  try {
    await client.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: me }),
        UpdateExpression: 'SET Credits = Credits - :cost, #items.#id = :next, UpdatedAt = :now',
        ConditionExpression: 'Credits >= :cost AND (attribute_not_exists(#items.#id) OR #items.#id = :cur)',
        ExpressionAttributeNames: { '#items': 'Items', '#id': item.ItemId },
        ExpressionAttributeValues: marshall({ ':cost': cost, ':next': cur + count, ':cur': cur, ':now': new Date().toISOString() }),
      })
    );
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
      return createErrorResponse(409, 'Try again', { Reason: 'Conflict' });
    }
    console.error('[BuyItem]', e);
    return createErrorResponse(500, 'Failed to buy');
  }

  console.log(`[BuyItem] ${me} ${item.ItemId} x${count} for ${cost}`);
  return createSuccessResponse({
    Bought: { ItemId: item.ItemId, Name: item.Name, Count: count, Cost: cost },
    ...toClientInventory(await readPlayerItems(me)),
  });
};
