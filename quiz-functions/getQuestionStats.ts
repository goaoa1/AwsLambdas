// ========================================
// getQuestionStats.ts - GET /get-question-stats (커리어 "정답률" 탭, 2026-11-09)
//   응답 Data: { Stats: { "<문제ID>": { A: 푼 횟수, C: 맞힌 횟수 } } }  (한 번도 안 푼 문제는 없음)
//   클라이언트는 DT_QuestionData 의 표현식("13*17")으로 19×19 판 칸을 찾는다.
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId } from './friendStore';
import { readStats } from './questionStats';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  try {
    return createSuccessResponse({ Stats: await readStats(me) });
  } catch (e) {
    console.error('[GetQuestionStats]', e);
    return createErrorResponse(500, 'Failed to load question stats');
  }
};
