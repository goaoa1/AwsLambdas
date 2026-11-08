// ========================================
// respondFriendRequest.ts - 받은 친구 요청 수락 / 거절
//   POST /respond-friend-request { FriendCode, Accept: true | false }
//   거절하면 두 사람 쪽 줄을 모두 지운다 (상대에게 따로 알리지 않음, 다시 요청할 수 있음).
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { buildFriendLists } from './friendLists';
import { acceptRequest, deleteRow, transact } from './friendActions';
import { Reason, getRow, getUserId, parseBody, resolveFriendCode } from './friendStore';
import { isConditionFailure } from './profileStore';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const body = parseBody<{ FriendCode?: string; Accept?: boolean }>(event.body);
  if (!body || typeof body.Accept !== 'boolean') return createErrorResponse(400, 'Invalid body', { Reason: Reason.InvalidInput });

  try {
    const other = await resolveFriendCode(String(body.FriendCode ?? ''));
    if (!other) return createErrorResponse(404, 'Not found', { Reason: Reason.NotFound });
    const mine = await getRow(me, other);
    if (mine?.Status !== 'Received') return createErrorResponse(409, 'No request', { Reason: Reason.NoRequest });

    if (body.Accept) {
      try {
        const r = await acceptRequest(me, other);
        if (r !== 'ok') return createErrorResponse(409, r, { Reason: r });
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
        return createErrorResponse(409, 'No request', { Reason: Reason.NoRequest });
      }
      console.log(`[RespondFriendRequest] ${me} accepted ${other}`);
      return createSuccessResponse({ Result: 'Friend', ...(await buildFriendLists(me)) });
    }

    await transact([deleteRow(me, other), deleteRow(other, me)]);
    console.log(`[RespondFriendRequest] ${me} declined ${other}`);
    return createSuccessResponse({ Result: 'Declined', ...(await buildFriendLists(me)) });
  } catch (e) {
    console.error('[RespondFriendRequest] error', e);
    return createErrorResponse(500, 'Friend error', { Reason: 'ServerError' });
  }
};
