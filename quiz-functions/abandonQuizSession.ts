import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getActiveSession, deleteSession } from 'quiz-utils/sessionManager';

export const handler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('[AbandonQuizSession] Lambda invoked');

  const userId = event.requestContext?.authorizer?.claims?.sub as string | undefined;
  if (!userId) {
    return createErrorResponse(401, 'Unauthorized');
  }

  console.log(`[AbandonQuizSession] UserId: ${userId}`);

  let session;
  try {
    session = await getActiveSession(userId);
  } catch (error) {
    console.error('[AbandonQuizSession] Failed to fetch active session:', error);
    throw error;
  }

  if (!session) {
    // 세션이 이미 없으면 목적 달성 — 200으로 반환 (멱등)
    console.log(`[AbandonQuizSession] No active session for player ${userId} — nothing to abandon`);
    return createSuccessResponse({ Abandoned: false });
  }

  try {
    await deleteSession(userId);
  } catch (error) {
    console.error('[AbandonQuizSession] Failed to delete session:', error);
    throw error;
  }

  console.log(`[AbandonQuizSession] Session abandoned for player ${userId} (QuizID: ${session.QuizID})`);
  return createSuccessResponse({ Abandoned: true, QuizID: session.QuizID });
};
