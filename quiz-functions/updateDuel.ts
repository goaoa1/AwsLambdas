// ========================================
// updateDuel.ts - POST /update-duel (대결 모드 D6, 2026-11-13)
//   본문 = 기기 저장 전체 { Won[], History[], Recent{}, MilkGiven } → 서버 값과 합쳐(duelStore.mergeDuel) 저장하고 합친 결과를 돌려준다.
//   오류 Reason: InvalidBody
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId, parseBody } from './friendStore';
import { mergeDuel, normalizeDuel, readDuel, writeDuel } from './duelStore';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const body = parseBody<Record<string, unknown>>(event.body);
  if (!body) return createErrorResponse(400, 'Invalid body', { Reason: 'InvalidBody' });
  try {
    const merged = mergeDuel(await readDuel(me), normalizeDuel(body));
    await writeDuel(me, merged);
    console.log(`[UpdateDuel] ${me} won=${merged.Won.length} history=${merged.History.length} milkGiven=${merged.MilkGiven}`);
    return createSuccessResponse({ Duel: merged });
  } catch (e) {
    console.error('[UpdateDuel] error', e);
    return createErrorResponse(500, 'Duel error', { Reason: 'ServerError' });
  }
};
