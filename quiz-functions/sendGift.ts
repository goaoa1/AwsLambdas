// ========================================
// sendGift.ts - 친구에게 스태미나 1 선물
//   POST /send-gift { FriendCode }
//   친구 사이이고, 오늘(한국 날짜) 그 친구에게 아직 보내지 않았을 때만. 내 스태미나는 줄지 않는다.
//   오류 Reason: NotFriends(403), AlreadyGifted(409)
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { marshall } from '@aws-sdk/util-dynamodb';
import { buildFriendLists } from './friendLists';
import { transact } from './friendActions';
import { FRIEND_TABLE, Reason, getRow, getUserId, parseBody, resolveFriendCode } from './friendStore';
import { isConditionFailure } from './profileStore';
import { GIFT_STAMINA, todayKST } from './giftRules';
import { addCounter } from './achievementStats';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const body = parseBody<{ FriendCode?: string }>(event.body);

  try {
    const other = await resolveFriendCode(String(body?.FriendCode ?? ''));
    if (!other) return createErrorResponse(404, 'Not found', { Reason: Reason.NotFound });
    const mine = await getRow(me, other);
    if (mine?.Status !== 'Friend') return createErrorResponse(403, 'Not friends', { Reason: Reason.NotFriends });
    const today = todayKST();
    if ((mine as { LastGiftDate?: string }).LastGiftDate === today) {
      return createErrorResponse(409, 'Already gifted', { Reason: 'AlreadyGifted' });
    }
    const now = new Date().toISOString();
    try {
      await transact([
        {
          Update: {
            TableName: FRIEND_TABLE,
            Key: marshall({ PlayerID: me, OtherID: other }),
            UpdateExpression: 'SET LastGiftDate = :today',
            ConditionExpression: '#s = :friend AND (attribute_not_exists(LastGiftDate) OR LastGiftDate <> :today)',
            ExpressionAttributeNames: { '#s': 'Status' },
            ExpressionAttributeValues: marshall({ ':today': today, ':friend': 'Friend' }),
          },
        },
        {
          Update: {
            TableName: FRIEND_TABLE,
            Key: marshall({ PlayerID: other, OtherID: me }),
            UpdateExpression: 'ADD GiftPending :one SET LastGiftAt = :now',
            ConditionExpression: '#s = :friend',
            ExpressionAttributeNames: { '#s': 'Status' },
            ExpressionAttributeValues: marshall({ ':one': GIFT_STAMINA, ':now': now, ':friend': 'Friend' }),
          },
        },
      ]);
    } catch (e) {
      if (!isConditionFailure(e)) throw e;
      return createErrorResponse(409, 'Already gifted', { Reason: 'AlreadyGifted' });
    }
    console.log(`[SendGift] ${me} -> ${other} (${today})`);
    // 도전과제 '선물 보내기' 진행도 (실패해도 선물은 이미 갔으므로 막지 않는다)
    await addCounter(me, 'GiftsSent').catch((e) => console.error('[SendGift] GiftsSent counter failed', e));
    return createSuccessResponse({ Result: 'Gifted', ...(await buildFriendLists(me)) });
  } catch (e) {
    console.error('[SendGift] error', e);
    return createErrorResponse(500, 'Gift error', { Reason: 'ServerError' });
  }
};
