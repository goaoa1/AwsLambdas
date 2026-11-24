// ========================================
// getBattleRecords.ts - GET /get-battle-records (마도서 창의 전투 기록, 2026-11-24 — 게임 저장소 Docs/퀴즈맵_전투_개편_계획.md §45)
//   판 끝(finish-battle)이 PlayerResources 에 적어 둔 전투 기록을 읽기만 한다 — 고치는 것은 없다.
//   응답 Data: { Records: { "<권 1~9>_<easy|normal|hard|veryhard>": { Plays, Wins, BestDamage, BestKills, BestChain, LastAt } },
//                Totals: { Plays, Wins, Kills, Damage, Answers, Corrects, Dodged } }
//   한 판도 안 했으면 둘 다 빈 맵.
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const PLAYER_TABLE = 'PlayerResources';

function getUserId(event: APIGatewayProxyEvent): string | undefined {
  return event.requestContext?.authorizer?.claims?.sub as string | undefined;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  try {
    const res = await dynamoDBClient.send(
      new GetItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: me }),
        ProjectionExpression: 'BattleRecords, BattleTotals',
      })
    );
    const item = (res.Item ? unmarshall(res.Item) : {}) as { BattleRecords?: Record<string, unknown>; BattleTotals?: Record<string, unknown> };
    return createSuccessResponse({ Records: item.BattleRecords ?? {}, Totals: item.BattleTotals ?? {} });
  } catch (e) {
    console.error('[GetBattleRecords]', e);
    return createErrorResponse(500, 'Failed to load battle records');
  }
};
