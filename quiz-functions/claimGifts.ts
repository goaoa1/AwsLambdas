// ========================================
// claimGifts.ts - 받은 선물 받기
//   POST /claim-gifts
//   지금 스태미나(회복분 포함)가 10 이 될 때까지만 받는다. 남은 선물은 그대로 둔다.
//   이미 10 이면 409 StaminaFull, 받을 선물이 없으면 409 NoGifts.
//   응답: { Claimed, Stamina, Remaining, ...내 목록 }
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { buildFriendLists } from './friendLists';
import { transact } from './friendActions';
import { FRIEND_TABLE, getUserId, listRows } from './friendStore';
import { dynamoDBClient, isConditionFailure } from './profileStore';
import { MAX_STAMINA, effectiveStamina } from './giftRules';

const PLAYER_TABLE = 'PlayerResources';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const rows = (await listRows(me)).filter((r) => r.Status === 'Friend' && Number((r as { GiftPending?: number }).GiftPending ?? 0) > 0);
      const total = rows.reduce((n, r) => n + Number((r as { GiftPending?: number }).GiftPending ?? 0), 0);
      if (total === 0) return createErrorResponse(409, 'No gifts', { Reason: 'NoGifts' });

      const res = await dynamoDBClient.send(
        new GetItemCommand({ TableName: PLAYER_TABLE, Key: marshall({ PlayerID: me }), ProjectionExpression: 'Stamina, LastStaminaUpdateAt', ConsistentRead: true })
      );
      const player = res.Item ? unmarshall(res.Item) : {};
      const stored = Number(player.Stamina ?? MAX_STAMINA);
      const { stamina, clock } = effectiveStamina(stored, player.LastStaminaUpdateAt);
      const room = MAX_STAMINA - stamina;
      if (room <= 0) return createErrorResponse(409, 'Stamina full', { Reason: 'StaminaFull', Stamina: stamina, Pending: total });

      // 오래된 선물부터 room 개만 받는다
      rows.sort((a, b) => String((a as { LastGiftAt?: string }).LastGiftAt ?? '').localeCompare(String((b as { LastGiftAt?: string }).LastGiftAt ?? '')));
      let left = Math.min(room, total);
      const claimed = left;
      const items: any[] = [];
      for (const r of rows) {
        if (left <= 0) break;
        const pending = Number((r as { GiftPending?: number }).GiftPending ?? 0);
        const take = Math.min(pending, left);
        left -= take;
        items.push({
          Update: {
            TableName: FRIEND_TABLE,
            Key: marshall({ PlayerID: me, OtherID: r.OtherID }),
            UpdateExpression: 'SET GiftPending = GiftPending - :n',
            ConditionExpression: 'GiftPending >= :n',
            ExpressionAttributeValues: marshall({ ':n': take }),
          },
        });
      }
      const newStamina = stamina + claimed;
      const full = newStamina >= MAX_STAMINA;
      // 다른 요청이 그 사이 스태미나를 바꿨으면 실패 → 다시 계산
      const cond = player.Stamina === undefined ? 'attribute_not_exists(Stamina)' : 'Stamina = :old';
      const values: Record<string, unknown> = { ':s': newStamina, ':now': new Date().toISOString() };
      if (player.Stamina !== undefined) values[':old'] = stored;
      if (!full && clock !== undefined) values[':clock'] = clock;
      items.push({
        Update: {
          TableName: PLAYER_TABLE,
          Key: marshall({ PlayerID: me }),
          UpdateExpression: full
            ? 'SET Stamina = :s, UpdatedAt = :now REMOVE LastStaminaUpdateAt'
            : clock !== undefined
              ? 'SET Stamina = :s, UpdatedAt = :now, LastStaminaUpdateAt = :clock'
              : 'SET Stamina = :s, UpdatedAt = :now',
          ConditionExpression: cond,
          ExpressionAttributeValues: marshall(values),
        },
      });
      try {
        await transact(items);
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
        continue;
      }
      console.log(`[ClaimGifts] ${me} +${claimed} -> ${newStamina} (left ${total - claimed})`);
      return createSuccessResponse({ Result: 'Claimed', Claimed: claimed, Stamina: newStamina, Remaining: total - claimed, ...(await buildFriendLists(me)) });
    }
    return createErrorResponse(409, 'Busy', { Reason: 'Busy' });
  } catch (e) {
    console.error('[ClaimGifts] error', e);
    return createErrorResponse(500, 'Gift error', { Reason: 'ServerError' });
  }
};
