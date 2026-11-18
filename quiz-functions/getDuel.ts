// ========================================
// getDuel.ts - GET /get-duel (대결 모드 D6, 2026-11-13)
//   { Duel: { Won[], History[], Recent{}, MilkGiven, UpdatedAt } }
//   클라이언트(UDuelSubsystem::RequestSync)가 메뉴에 올 때 받아 기기 저장과 합치고, 기기 쪽이 앞서 있으면 update-duel 로 올린다.
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId } from './friendStore';
import { readDuel } from './duelStore';
import { readQuizMilk } from './quizMilk';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  try {
    const duel = await readDuel(me);
    // 판 끝 우유 (quizMilk.ts, 2026-11-18): 판마다 받은 바나나우유 합 — 가방 우유 = 이긴 칸 + QuizMilk − MilkGiven
    let quizMilk = 0;
    try {
      quizMilk = await readQuizMilk(me);
    } catch (e) {
      console.error('[GetDuel] quiz milk read failed', e);
    }
    console.log(`[GetDuel] ${me} won=${duel.Won.length} history=${duel.History.length} milkGiven=${duel.MilkGiven} quizMilk=${quizMilk}`);
    return createSuccessResponse({ Duel: { ...duel, QuizMilk: quizMilk } });
  } catch (e) {
    console.error('[GetDuel] error', e);
    return createErrorResponse(500, 'Duel error', { Reason: 'ServerError' });
  }
};
