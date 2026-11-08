// ========================================
// removeFriend.ts - 친구 삭제, 또는 보낸 요청 취소
//   POST /remove-friend { FriendCode }
//   두 사람 쪽 줄을 모두 지운다 (상대 목록에서도 사라짐).
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { buildFriendLists } from './friendLists';
import { deleteRow, transact } from './friendActions';
import { Reason, getRow, getUserId, parseBody, resolveFriendCode } from './friendStore';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const body = parseBody<{ FriendCode?: string }>(event.body);

  try {
    const other = await resolveFriendCode(String(body?.FriendCode ?? ''));
    if (!other) return createErrorResponse(404, 'Not found', { Reason: Reason.NotFound });
    const mine = await getRow(me, other);
    if (mine?.Status !== 'Friend' && mine?.Status !== 'Sent') {
      return createErrorResponse(409, 'Not friends', { Reason: Reason.NotFriends });
    }
    await transact([deleteRow(me, other), deleteRow(other, me)]);
    console.log(`[RemoveFriend] ${me} removed ${other} (${mine.Status})`);
    return createSuccessResponse({ Result: 'Removed', ...(await buildFriendLists(me)) });
  } catch (e) {
    console.error('[RemoveFriend] error', e);
    return createErrorResponse(500, 'Friend error', { Reason: 'ServerError' });
  }
};
