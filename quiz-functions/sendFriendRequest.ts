// ========================================
// sendFriendRequest.ts - 친구 요청 보내기
//   POST /send-friend-request { FriendCode }
//   상대도 나에게 요청을 보내 둔 상태면 바로 친구가 된다.
//   나를 차단한 사람에게는 NotFound 와 같은 응답을 준다 (차단 사실을 알리지 않음).
//   응답: 성공이면 { Result: 'Sent' | 'Friend', ...내 목록 }
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { buildFriendLists } from './friendLists';
import { acceptRequest, putRow, transact } from './friendActions';
import { MAX_FRIENDS, MAX_RECEIVED, MAX_SENT, Reason, countStatus, getRow, getUserId, listRows, parseBody, resolveFriendCode } from './friendStore';
import { isConditionFailure, readProfile } from './profileStore';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const body = parseBody<{ FriendCode?: string }>(event.body);

  try {
    const myProfile = await readProfile(me);
    if (!myProfile?.Nickname) return createErrorResponse(409, 'Set nickname first', { Reason: Reason.NoNickname });

    const other = await resolveFriendCode(String(body?.FriendCode ?? ''));
    if (!other) return createErrorResponse(404, 'Not found', { Reason: Reason.NotFound });
    if (other === me) return createErrorResponse(400, 'Self', { Reason: Reason.Self });

    const [mine, theirs] = await Promise.all([getRow(me, other), getRow(other, me)]);
    if (theirs?.Status === 'Blocked') return createErrorResponse(404, 'Not found', { Reason: Reason.NotFound });
    if (mine?.Status === 'Blocked') return createErrorResponse(409, 'Blocked', { Reason: Reason.Blocked });
    if (mine?.Status === 'Friend') return createErrorResponse(409, 'Already friends', { Reason: Reason.AlreadyFriends });
    if (mine?.Status === 'Sent') return createErrorResponse(409, 'Already sent', { Reason: Reason.AlreadySent });

    if (mine?.Status === 'Received') {
      // 서로 요청함 → 친구
      const r = await acceptRequest(me, other);
      if (r !== 'ok') return createErrorResponse(409, r, { Reason: r });
      console.log(`[SendFriendRequest] ${me} <-> ${other} friends (mutual)`);
      return createSuccessResponse({ Result: 'Friend', ...(await buildFriendLists(me)) });
    }

    const [myRows, theirRows] = await Promise.all([listRows(me), listRows(other)]);
    if (countStatus(myRows, 'Friend') >= MAX_FRIENDS) return createErrorResponse(409, 'Full', { Reason: Reason.MyFriendsFull });
    if (countStatus(myRows, 'Sent') >= MAX_SENT) return createErrorResponse(409, 'Full', { Reason: Reason.MySentFull });
    if (countStatus(theirRows, 'Friend') >= MAX_FRIENDS) return createErrorResponse(409, 'Full', { Reason: Reason.TheirFriendsFull });
    if (countStatus(theirRows, 'Received') >= MAX_RECEIVED) return createErrorResponse(409, 'Full', { Reason: Reason.TheirInboxFull });

    const now = new Date().toISOString();
    try {
      await transact([
        putRow(me, other, 'Sent', now, 'attribute_not_exists(PlayerID)'),
        putRow(other, me, 'Received', now, 'attribute_not_exists(PlayerID)'),
      ]);
    } catch (e) {
      if (!isConditionFailure(e)) throw e;
      return createErrorResponse(409, 'Changed', { Reason: Reason.AlreadySent });
    }
    console.log(`[SendFriendRequest] ${me} -> ${other}`);
    return createSuccessResponse({ Result: 'Sent', ...(await buildFriendLists(me)) });
  } catch (e) {
    console.error('[SendFriendRequest] error', e);
    return createErrorResponse(500, 'Friend error', { Reason: 'ServerError' });
  }
};
