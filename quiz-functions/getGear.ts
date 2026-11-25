// ========================================
// getGear.ts - GET /get-gear (장비 · 스킬 G1, 2026-11-25 — Docs/장비_스킬_계획.md)
//   장비 정의 · 가진 수 · 끼고 있는 수 · 캐릭터마다 칸 셋 · 스킬 레벨 · 스킬 책 수 · 레벨업 책 표 · 크레딧
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId } from './friendStore';
import { readPlayerGear, toClientGear } from './gearStore';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  try {
    const row = await readPlayerGear(me);
    if (!row.Exists) return createErrorResponse(404, 'Player not found', { Reason: 'NoPlayer' });
    return createSuccessResponse(toClientGear(row));
  } catch (e) {
    console.error('[GetGear]', e);
    return createErrorResponse(500, 'Failed to load gear');
  }
};
