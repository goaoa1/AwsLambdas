// ========================================
// getInventory.ts - GET /get-inventory
//   아이템 목록(이름·효과·가격·가진 수) + 크레딧 + 지금 스태미나(회복분 반영)
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId } from './friendStore';
import { readPlayerItems, toClientInventory } from './inventoryStore';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  try {
    const row = await readPlayerItems(me);
    if (!row.Exists) return createErrorResponse(404, 'Player not found', { Reason: 'NoPlayer' });
    return createSuccessResponse(toClientInventory(row));
  } catch (e) {
    console.error('[GetInventory]', e);
    return createErrorResponse(500, 'Failed to load inventory');
  }
};
