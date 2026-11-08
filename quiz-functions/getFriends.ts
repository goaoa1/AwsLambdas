// ========================================
// getFriends.ts - 내 친구 / 받은 요청 / 보낸 요청 / 차단 목록
//   GET /get-friends
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { buildFriendLists } from './friendLists';
import { getUserId } from './friendStore';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  try {
    return createSuccessResponse(await buildFriendLists(me));
  } catch (e) {
    console.error('[GetFriends] error', e);
    return createErrorResponse(500, 'Friends error', { Reason: 'ServerError' });
  }
};
