import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { resumeSession } from 'quiz-utils/sessionManager';

export const handler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('[ResumeSession] Lambda invoked');

  const userId = event.requestContext?.authorizer?.claims?.sub as string | undefined;
  if (!userId) {
    return createErrorResponse(401, 'Unauthorized');
  }

  try {
    const session = await resumeSession(userId);
    return createSuccessResponse({ LastResumeTime: session.LastResumeTime });
  } catch (error) {
    console.error('[ResumeSession] Error:', error);
    throw error;
  }
};
