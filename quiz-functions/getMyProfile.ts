// ========================================
// getMyProfile.ts - 내 공개 프로필 (닉네임, 친구 코드) + 닉네임 단어 목록
//   GET /get-my-profile
//   처음 부르면 친구 코드를 만들어 준다. 닉네임이 비어 있으면 앱이 닉네임 고르기 창을 띄운다.
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { NICKNAME_WORDS, ensureProfile, toClientProfile } from './profileStore';

export const handler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext?.authorizer?.claims?.sub as string | undefined;
  if (!userId) {
    return createErrorResponse(401, 'Unauthorized');
  }
  try {
    const profile = await ensureProfile(userId);
    console.log(`[GetMyProfile] ${userId} code=${profile.FriendCode} nick=${profile.Nickname ?? ''}`);
    return createSuccessResponse({ Profile: toClientProfile(profile), NicknameWords: NICKNAME_WORDS });
  } catch (e) {
    console.error('[GetMyProfile] error', e);
    return createErrorResponse(500, 'Profile error', { Reason: 'ServerError' });
  }
};
