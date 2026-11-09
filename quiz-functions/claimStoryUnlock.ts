// ========================================
// claimStoryUnlock.ts - POST /claim-story-unlock { CharacterId, UnlockId }
//   에피소드가 연 해금(Story.<char>.Unlocked 에 있음)의 보상(storyCatalog.ts)을 한 번만 준다.
//   한 UpdateItem 으로: Story.<char>.Claimed 에 추가(조건: 아직 없음) + 아이템/의상/크레딧 지급 (claimAchievement 와 같은 규칙)
//   오류 Reason: UnknownCharacter / UnknownUnlock(보상 없는 id) / NotUnlocked / AlreadyClaimed / Conflict
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId, parseBody } from './friendStore';
import { CHARACTER_IDS, PLAYER_TABLE, emptyCharState, readStoryRow } from './storyStore';
import { findStoryReward } from './storyCatalog';
import { ensureItemsMap, grantItemsExpression, readPlayerItems } from './inventoryStore';
import { ITEM_NAME } from './itemCatalog';

const client = new DynamoDBClient({ region: process.env.REGION });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const body = parseBody<{ CharacterId?: string; UnlockId?: string }>(event.body);
  const characterId = body?.CharacterId ?? '';
  const unlockId = body?.UnlockId ?? '';
  if (!CHARACTER_IDS.has(characterId)) return createErrorResponse(400, 'Unknown character', { Reason: 'UnknownCharacter' });
  const reward = findStoryReward(unlockId);
  if (!reward) return createErrorResponse(400, 'No reward for this unlock', { Reason: 'UnknownUnlock' });

  try {
    const { Story, Row } = await readStoryRow(me);
    const state = Story[characterId] ?? emptyCharState();
    if (!state.Unlocked.includes(unlockId)) return createErrorResponse(409, 'Not unlocked yet', { Reason: 'NotUnlocked' });
    if (state.Claimed.includes(unlockId)) return createErrorResponse(409, 'Already claimed', { Reason: 'AlreadyClaimed' });

    // Unlocked 에 있다는 건 Story.<char> 가 이미 있다는 뜻 → 중첩 경로에 바로 쓴다. 받은 표시는 Claimed 에 아직 없을 때만 더한다.
    const sets: string[] = ['#story.#c.#cl = list_append(if_not_exists(#story.#c.#cl, :emptyList), :claim)', 'UpdatedAt = :now'];
    const conds: string[] = ['attribute_exists(#story.#c)', '(attribute_not_exists(#story.#c.#cl) OR NOT contains(#story.#c.#cl, :unlockId))'];
    const names: Record<string, string> = { '#story': 'Story', '#c': characterId, '#cl': 'Claimed' };
    const values: Record<string, unknown> = { ':emptyList': [], ':claim': [unlockId], ':unlockId': unlockId, ':now': new Date().toISOString() };

    let itemsGranted: Record<string, number> = {};
    if (reward.Items && Object.values(reward.Items).some((n) => n > 0)) {
      await ensureItemsMap(me);
      const cur = (await readPlayerItems(me)).Items;
      const g = grantItemsExpression(reward.Items, cur, 'i');
      sets.push(...g.sets);
      conds.push(...g.conds);
      Object.assign(names, g.names);
      Object.assign(values, g.values);
      itemsGranted = g.granted;
    }
    let outfitGranted = '';
    if (reward.Outfit) {
      const owned = (Row.OwnedOutfits as unknown[] | undefined) ?? [];
      if (!owned.includes(reward.Outfit)) {
        sets.push('OwnedOutfits = list_append(if_not_exists(OwnedOutfits, :emptyList), :newOutfit)');
        conds.push('(attribute_not_exists(OwnedOutfits) OR NOT contains(OwnedOutfits, :outfitId))');
        values[':newOutfit'] = [reward.Outfit];
        values[':outfitId'] = reward.Outfit;
        outfitGranted = reward.Outfit;
      }
    }
    if (reward.Credits && reward.Credits > 0) {
      sets.push('Credits = if_not_exists(Credits, :zero) + :credits');
      values[':credits'] = reward.Credits;
      values[':zero'] = 0;
    }
    try {
      await client.send(
        new UpdateItemCommand({
          TableName: PLAYER_TABLE,
          Key: marshall({ PlayerID: me }),
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: conds.join(' AND '),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: marshall(values),
        })
      );
    } catch (e) {
      if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
        return createErrorResponse(409, 'Already claimed or changed', { Reason: 'Conflict' });
      }
      throw e;
    }
    const granted = Object.entries(itemsGranted).filter(([, n]) => n > 0).map(([id, n]) => `${ITEM_NAME(id)} ×${n}`);
    if (outfitGranted) granted.push(outfitGranted);
    if (reward.Credits) granted.push(`${reward.Credits} 크레딧`);
    console.log(`[ClaimStoryUnlock] ${me} ${characterId} ${unlockId}: ${granted.join(', ')}`);
    return createSuccessResponse({ CharacterId: characterId, UnlockId: unlockId, Items: itemsGranted, Outfit: outfitGranted, Credits: reward.Credits ?? 0, Text: granted.join(', ') });
  } catch (e) {
    console.error('[ClaimStoryUnlock] error', e);
    return createErrorResponse(500, 'Story error', { Reason: 'ServerError' });
  }
};
