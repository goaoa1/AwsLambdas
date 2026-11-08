// ========================================
// equipTitle.ts - 도전과제 3단계: 받은 칭호 하나를 골라 프로필에 단다
//   POST /equip-title { TitleId }   TitleId '' = 칭호 떼기
//   받은 칭호인지는 PlayerAchievements 의 ClaimedTiers 로 확인한다 (칭호는 따로 저장하지 않음)
//   PlayerProfiles.EquippedTitle 에 ID 를 넣고, 내 프로필(칭호 이름 포함)을 돌려준다
//   응답: { Profile, Titles: [{Id, Name}] }   오류 Reason: NotOwned / ServerError
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { ACHIEVEMENTS, TITLES } from './achievementCatalog';
import { readClaimed } from './achievementProgress';
import { PROFILE_TABLE } from './profileCatalog';
import { dynamoDBClient, ensureProfile, readProfile, toClientProfile } from './profileStore';

export async function ownedTitleIds(playerId: string): Promise<string[]> {
  const claimed = await readClaimed(playerId);
  const ids: string[] = [];
  for (const a of ACHIEVEMENTS) {
    a.Tiers.slice(0, claimed.get(a.Id) ?? 0).forEach((t) => t.Reward.Title && ids.push(t.Reward.Title));
  }
  return ids;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = event.requestContext?.authorizer?.claims?.sub as string | undefined;
  if (!me) return createErrorResponse(401, 'Unauthorized');
  let titleId = '';
  try {
    titleId = String(JSON.parse(event.body || '{}')?.TitleId ?? '').trim();
  } catch {
    return createErrorResponse(400, 'Bad body', { Reason: 'BadRequest' });
  }

  try {
    const owned = await ownedTitleIds(me);
    if (titleId && !owned.includes(titleId)) {
      return createErrorResponse(403, 'Title not owned', { Reason: 'NotOwned' });
    }
    await ensureProfile(me);
    const now = new Date().toISOString();
    await dynamoDBClient.send(
      new UpdateItemCommand({
        TableName: PROFILE_TABLE,
        Key: marshall({ PlayerID: me }),
        UpdateExpression: titleId ? 'SET EquippedTitle = :t, UpdatedAt = :now' : 'REMOVE EquippedTitle SET UpdatedAt = :now',
        ExpressionAttributeValues: marshall(titleId ? { ':t': titleId, ':now': now } : { ':now': now }),
      })
    );
    const profile = await readProfile(me);
    console.log(`[EquipTitle] ${me} -> ${titleId || '(none)'}`);
    return createSuccessResponse({
      Profile: toClientProfile(profile ?? { PlayerID: me }),
      Titles: owned.map((id) => ({ Id: id, Name: TITLES[id] ?? id })),
    });
  } catch (e) {
    console.error('[EquipTitle] error', e);
    return createErrorResponse(500, 'Equip title error', { Reason: 'ServerError' });
  }
};
