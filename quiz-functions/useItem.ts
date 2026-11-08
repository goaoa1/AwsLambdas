// ========================================
// useItem.ts - POST /use-item { ItemId }
//   스태미나 아이템 하나를 쓴다. 스태미나는 회복분 포함 최대 10 까지 (선물·도전과제와 같은 규칙).
//   UpdateItem 하나로: Items.#id - 1 (조건: 1개 이상), Stamina 설정 (조건: 읽은 값 그대로), 회복 시계 정리.
//   오류 Reason: UnknownItem / NoItem / StaminaFull / Conflict
//   응답: Used { ItemId, Gained, Stamina } + 새 인벤토리
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId, parseBody } from './friendStore';
import { findItem } from './itemCatalog';
import { PLAYER_TABLE, readPlayerItems, toClientInventory } from './inventoryStore';
import { MAX_STAMINA } from './giftRules';

const client = new DynamoDBClient({ region: process.env.REGION });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const item = findItem(parseBody<{ ItemId?: string }>(event.body)?.ItemId);
  if (!item) return createErrorResponse(400, 'Unknown item', { Reason: 'UnknownItem' });

  const now = Date.now();
  const row = await readPlayerItems(me, now);
  if ((row.Items[item.ItemId] ?? 0) < 1) return createErrorResponse(409, 'No item', { Reason: 'NoItem' });
  if (row.Stamina >= MAX_STAMINA) return createErrorResponse(409, 'Stamina is full', { Reason: 'StaminaFull' });

  const next = item.Stamina === 'Full' ? MAX_STAMINA : Math.min(MAX_STAMINA, row.Stamina + item.Stamina);
  const gained = next - row.Stamina;
  const values: Record<string, unknown> = {
    ':one': 1,
    ':stamina': next,
    ':stored': row.StoredStamina,
    ':now': new Date(now).toISOString(),
  };
  let update = 'SET #items.#id = #items.#id - :one, Stamina = :stamina, UpdatedAt = :now';
  if (next >= MAX_STAMINA) update += ' REMOVE LastStaminaUpdateAt';
  else {
    update += ', LastStaminaUpdateAt = :clock';
    values[':clock'] = row.Clock ?? now;
  }

  try {
    await client.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: me }),
        UpdateExpression: update,
        ConditionExpression: '#items.#id >= :one AND (Stamina = :stored OR attribute_not_exists(Stamina))',
        ExpressionAttributeNames: { '#items': 'Items', '#id': item.ItemId },
        ExpressionAttributeValues: marshall(values),
      })
    );
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
      return createErrorResponse(409, 'Try again', { Reason: 'Conflict' });
    }
    console.error('[UseItem]', e);
    return createErrorResponse(500, 'Failed to use item');
  }

  console.log(`[UseItem] ${me} ${item.ItemId} stamina ${row.Stamina} -> ${next}`);
  return createSuccessResponse({
    Used: { ItemId: item.ItemId, Name: item.Name, Gained: gained, Stamina: next },
    ...toClientInventory(await readPlayerItems(me)),
  });
};
