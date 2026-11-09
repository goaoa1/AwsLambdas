// ========================================
// getShop.ts - 상점 화면 진입 시 카탈로그 + 플레이어 상점 상태 조회
//   GET /get-shop
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { CREDIT_PACKS, OUTFITS, isStoryLocked } from './shopCatalog';
import { hasUnlock, normalizeCharState, type StoryMap } from './storyStore';
import { readShopState } from './shopState';

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const PLAYER_TABLE = 'PlayerResources';

export const handler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('[GetShop] Lambda invoked');

  const userId = event.requestContext?.authorizer?.claims?.sub as string | undefined;
  if (!userId) {
    return createErrorResponse(401, 'Unauthorized');
  }

  const getResult = await dynamoDBClient.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      ProjectionExpression: 'Credits, OwnedOutfits, EquippedOutfits, #story',
      ExpressionAttributeNames: { '#story': 'Story' },
    })
  );

  const row = getResult.Item ? unmarshall(getResult.Item) : undefined;
  const state = readShopState(row);
  // 스토리 해금 전 의상 (2026-11-09)
  const story: StoryMap = {};
  for (const [k, v] of Object.entries(((row?.Story as Record<string, unknown>) ?? {}))) story[k] = normalizeCharState(v);
  const lockedOutfits = OUTFITS.filter((o) => isStoryLocked(o, (id) => hasUnlock(story, id))).map((o) => o.OutfitId);

  return createSuccessResponse({
    Credits: state.Credits,
    OwnedOutfits: state.OwnedOutfits,
    EquippedOutfits: state.EquippedOutfits,
    Outfits: OUTFITS,
    LockedOutfits: lockedOutfits,
    CreditPacks: CREDIT_PACKS,
    SandboxPurchaseAllowed: process.env.ALLOW_SANDBOX_PURCHASE === 'true',
  });
};
