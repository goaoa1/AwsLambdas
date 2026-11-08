// ========================================
// blockPlayer.ts - 차단 / 차단 풀기
//   POST /block-player { FriendCode, Unblock?: boolean }
//   차단: 내 줄을 Blocked 로 덮어쓰고 상대 쪽 줄은 지운다 (친구·요청 모두 끊김).
//         상대는 검색에서 나를 못 찾고, 요청을 보내면 '없는 코드'와 같은 응답을 받는다.
//   차단 풀기: 내 Blocked 줄만 지운다 (예전 관계는 돌아오지 않음).
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { buildFriendLists } from './friendLists';
import { deleteRow, putRow, transact } from './friendActions';
import { Reason, getRow, getUserId, parseBody, resolveFriendCode } from './friendStore';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const body = parseBody<{ FriendCode?: string; Unblock?: boolean }>(event.body);

  try {
    const other = await resolveFriendCode(String(body?.FriendCode ?? ''));
    if (!other) return createErrorResponse(404, 'Not found', { Reason: Reason.NotFound });
    if (other === me) return createErrorResponse(400, 'Self', { Reason: Reason.Self });

    if (body?.Unblock) {
      const mine = await getRow(me, other);
      if (mine?.Status === 'Blocked') await transact([deleteRow(me, other)]);
      console.log(`[BlockPlayer] ${me} unblocked ${other}`);
      return createSuccessResponse({ Result: 'Unblocked', ...(await buildFriendLists(me)) });
    }

    const now = new Date().toISOString();
    const theirs = await getRow(other, me);
    const items = [putRow(me, other, 'Blocked', now)];
    // 상대도 나를 차단했다면 그 줄은 그대로 둔다 (서로 차단)
    if (theirs && theirs.Status !== 'Blocked') items.push(deleteRow(other, me) as any);
    await transact(items as any);
    console.log(`[BlockPlayer] ${me} blocked ${other}`);
    return createSuccessResponse({ Result: 'Blocked', ...(await buildFriendLists(me)) });
  } catch (e) {
    console.error('[BlockPlayer] error', e);
    return createErrorResponse(500, 'Friend error', { Reason: 'ServerError' });
  }
};
