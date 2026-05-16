import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { pauseSession } from 'quiz-utils/sessionManager';

export const handler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('[PauseSession] Lambda invoked');

  const userId = event.requestContext?.authorizer?.claims?.sub as string | undefined;
  if (!userId) {
    return createErrorResponse(401, 'Unauthorized');
  }

  try {
    const session = await pauseSession(userId);
    return createSuccessResponse({ AccumulatedPlayTime: session.AccumulatedPlayTime });
  } catch (error) {
    console.error('[PauseSession] Error:', error);
    throw error;
  }
};
