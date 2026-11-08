// ========================================
// inventoryStore.ts - 아이템 개수 (PlayerResources.Items: { Item_StaminaS: 3, ... })
//   스태미나와 같은 줄이라 "아이템 -1, 스태미나 +n" 을 UpdateItem 하나로 처리할 수 있다.
//   중첩 경로(Items.#id)를 쓰려면 Items 맵이 먼저 있어야 해서 ensureItemsMap 을 앞에 부른다.
// ========================================
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ITEMS, MAX_ITEM_COUNT } from './itemCatalog';
import { MAX_STAMINA, effectiveStamina } from './giftRules';

export const PLAYER_TABLE = 'PlayerResources';
const client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });

export interface PlayerItemsRow {
  Items: Record<string, number>;
  Credits: number;
  StoredStamina: number;
  Stamina: number;           // 회복분 반영한 지금 값
  Clock: number | undefined; // 회복분 반영한 회복 시계
  Exists: boolean;
}

export async function readPlayerItems(playerId: string, nowMs = Date.now()): Promise<PlayerItemsRow> {
  const r = await client.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: playerId }),
      ProjectionExpression: 'PlayerID, #items, Credits, Stamina, LastStaminaUpdateAt',
      ExpressionAttributeNames: { '#items': 'Items' }, // Items 는 DynamoDB 예약어
    })
  );
  const p = r.Item ? unmarshall(r.Item) : {};
  const stored = Number(p.Stamina) || 0;
  const eff = effectiveStamina(stored, p.LastStaminaUpdateAt as number | undefined, nowMs);
  const items: Record<string, number> = {};
  for (const [k, v] of Object.entries((p.Items as Record<string, unknown>) ?? {})) items[k] = Number(v) || 0;
  return { Items: items, Credits: Number(p.Credits) || 0, StoredStamina: stored, Stamina: eff.stamina, Clock: eff.clock, Exists: !!r.Item };
}

/** Items 맵이 없으면 빈 맵을 만든다 (플레이어 줄이 있을 때만) */
export async function ensureItemsMap(playerId: string) {
  try {
    await client.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: playerId }),
        UpdateExpression: 'SET #items = if_not_exists(#items, :empty)',
        ConditionExpression: 'attribute_exists(PlayerID)',
        ExpressionAttributeNames: { '#items': 'Items' },
        ExpressionAttributeValues: marshall({ ':empty': {} }),
      })
    );
  } catch (e) {
    if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e;
  }
}

/** 클라이언트용: 목록 순서대로, 가진 수와 함께 */
export function toClientInventory(row: PlayerItemsRow) {
  return {
    Items: ITEMS.map((i) => ({
      ItemId: i.ItemId,
      Name: i.Name,
      Desc: i.Desc,
      Stamina: i.Stamina === 'Full' ? MAX_STAMINA : i.Stamina,
      bFull: i.Stamina === 'Full',
      Price: i.Price,
      Count: row.Items[i.ItemId] ?? 0,
    })),
    Credits: row.Credits,
    Stamina: row.Stamina,
    MaxStamina: MAX_STAMINA,
    MaxItemCount: MAX_ITEM_COUNT,
  };
}

/**
 * 트랜잭션에 넣을 "아이템 n 개 주기" 조각 (Update 의 SET 부분과 값들).
 * 99 개를 넘으면 99 에 맞춘다 (넘치는 만큼은 버림). current 는 읽어 둔 지금 개수.
 * conds: 읽은 뒤 개수가 바뀌지 않았어야 한다 (동시에 두 번 받을 때 하나가 덮어쓰지 않게)
 */
export function grantItemsExpression(grants: Record<string, number>, current: Record<string, number>, prefix = 'g') {
  const sets: string[] = [];
  const conds: string[] = [];
  const names: Record<string, string> = { '#items': 'Items' }; // Items 는 DynamoDB 예약어
  const values: Record<string, unknown> = {};
  const granted: Record<string, number> = {};
  let i = 0;
  for (const [itemId, n] of Object.entries(grants)) {
    if (!n || n <= 0) continue;
    const cur = current[itemId] ?? 0;
    const next = Math.min(MAX_ITEM_COUNT, cur + n);
    granted[itemId] = next - cur;
    names[`#${prefix}${i}`] = itemId;
    values[`:${prefix}${i}`] = next;
    sets.push(`#items.#${prefix}${i} = :${prefix}${i}`);
    values[`:${prefix}c${i}`] = cur;
    conds.push(`(attribute_not_exists(#items.#${prefix}${i}) OR #items.#${prefix}${i} = :${prefix}c${i})`);
    i++;
  }
  // 줄 아이템이 없으면 #items 도 빼야 한다 (쓰지 않는 이름이 있으면 DynamoDB 가 거절)
  if (!sets.length) delete names['#items'];
  return { sets, conds, names, values, granted };
}
