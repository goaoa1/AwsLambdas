import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getActiveSession } from 'quiz-utils/sessionManager';

export const handler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('[GetQuizSession] Lambda invoked');

  const userId = event.requestContext?.authorizer?.claims?.sub as string | undefined;
  if (!userId) {
    return createErrorResponse(401, 'Unauthorized');
  }

  let session;
  try {
    session = await getActiveSession(userId);
  } catch (error) {
    console.error('[GetQuizSession] Failed to fetch session:', error);
    throw error;
  }

  if (!session) {
    return createErrorResponse(404, 'No active session');
  }

  // 서버 시각 기준 총 경과 시간(초)을 계산해서 응답한다.
  // 클라이언트 시계 동기화 불필요. 일시정지 상태면 누적값만 그대로 반환.
  const accumulated = session.AccumulatedPlayTime ?? 0;
  const currentElapsed = session.IsPaused
    ? accumulated
    : accumulated + (Date.now() - session.LastResumeTime) / 1000;

  return createSuccessResponse({
    Session: {
      ...session,
      AccumulatedPlayTime: currentElapsed,
    },
  });
};
