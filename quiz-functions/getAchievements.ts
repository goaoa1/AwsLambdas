// ========================================
// getAchievements.ts - GET /get-achievements
//   도전과제 목록 + 진행도 + 단계별 보상/받음 여부 + 받을 수 있는 개수(ClaimableCount) + 얻은 칭호
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId } from './friendStore';
import { buildAchievementList } from './achievementProgress';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  try {
    return createSuccessResponse(await buildAchievementList(me));
  } catch (e) {
    console.error('[GetAchievements]', e);
    return createErrorResponse(500, 'Failed to load achievements');
  }
};
