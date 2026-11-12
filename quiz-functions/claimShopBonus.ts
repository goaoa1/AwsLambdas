// ========================================
// claimShopBonus.ts - POST /claim-shop-bonus  (현실 연결 R9, 2026-11-12)
//   매점 계산에서 포스기보다 먼저 합계를 넣으면 덤 — 원고: "이기면 아주머니가 덤으로 요구르트 하나를 준다.
//   덤은 크레딧이나 스태미나 같은 작은 보상으로 바꿔도 된다." → 크레딧 SHOP_BONUS_CREDITS, 하루(KST) SHOP_BONUS_DAILY_CAP 번.
//   본문 { Table: 11~19, Count: 1~19 } (판 뒤 매점 장면의 단·개수 — 값 확인용)
//   응답 { Granted, Credits, Remaining }  하루 한도면 Granted 0 · Reason "DailyCap" (200)
//   PlayerResources: Credits, ShopBonusDate(KST yyyy-mm-dd), ShopBonusToday
//   오류 Reason: InvalidBody / Conflict(동시에 두 번 — 다시 보내면 됨)
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId, parseBody } from './friendStore';

const client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });
const PLAYER_TABLE = 'PlayerResources';
export const SHOP_BONUS_CREDITS = 3;
export const SHOP_BONUS_DAILY_CAP = 3;

function todayKST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const body = parseBody<{ Table?: unknown; Count?: unknown }>(event.body);
  const table = Math.floor(Number(body?.Table));
  const count = Math.floor(Number(body?.Count));
  if (!(table >= 11 && table <= 19) || !(count >= 1 && count <= 19)) {
    return createErrorResponse(400, 'Invalid table or count', { Reason: 'InvalidBody' });
  }

  const today = todayKST();
  const got = await client.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: me }),
      ProjectionExpression: 'Credits, ShopBonusDate, ShopBonusToday',
    })
  );
  const row = got.Item ? unmarshall(got.Item) : {};
  const used = row.ShopBonusDate === today ? Math.max(0, Number(row.ShopBonusToday) || 0) : 0;
  if (used >= SHOP_BONUS_DAILY_CAP) {
    return createSuccessResponse({ Granted: 0, Credits: Number(row.Credits) || 0, Remaining: 0, Reason: 'DailyCap' });
  }

  try {
    const r = await client.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: me }),
        UpdateExpression: 'SET Credits = if_not_exists(Credits, :zero) + :credits, ShopBonusDate = :today, ShopBonusToday = :next, UpdatedAt = :now',
        // 읽은 값 그대로일 때만 (동시에 두 번 눌러 한도를 넘지 않게)
        ConditionExpression: used === 0
          ? 'attribute_exists(PlayerID) AND (attribute_not_exists(ShopBonusDate) OR ShopBonusDate <> :today OR ShopBonusToday = :used)'
          : 'attribute_exists(PlayerID) AND ShopBonusDate = :today AND ShopBonusToday = :used',
        ExpressionAttributeValues: marshall({
          ':zero': 0,
          ':credits': SHOP_BONUS_CREDITS,
          ':today': today,
          ':next': used + 1,
          ':used': used,
          ':now': new Date().toISOString(),
        }),
        ReturnValues: 'UPDATED_NEW',
      })
    );
    const credits = Number(r.Attributes ? unmarshall(r.Attributes).Credits : 0) || 0;
    console.log(`[ClaimShopBonus] ${me} table=${table} count=${count} +${SHOP_BONUS_CREDITS} (${used + 1}/${SHOP_BONUS_DAILY_CAP}) credits=${credits}`);
    return createSuccessResponse({ Granted: SHOP_BONUS_CREDITS, Credits: credits, Remaining: SHOP_BONUS_DAILY_CAP - used - 1 });
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
      return createErrorResponse(409, 'Try again', { Reason: 'Conflict' });
    }
    console.error('[ClaimShopBonus]', e);
    return createErrorResponse(500, 'Failed to grant shop bonus');
  }
};
