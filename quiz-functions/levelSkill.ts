// ========================================
// levelSkill.ts - POST /level-skill { CharacterId } (장비 · 스킬 G1, 2026-11-25 — 사용자: 자기 스킬 레벨업, 전투 보상 '스킬 책'으로)
//   다음 레벨에 드는 스킬 책(BOOKS_TO_LEVEL — Lv2 1 · Lv3 2 · Lv4 3 · Lv5 4)을 쓰고 그 캐릭터의 스킬 레벨 +1 (최대 5).
//   UpdateItem 하나로: 책 수 줄이기(조건: 읽은 수 그대로) + SkillLevels 맵 + GearRev (조건: 그대로)
//   스킬 수치는 기기(waves.json skills.<캐릭터>.levels)가 쓴다 — 서버는 레벨만 갖는다.
//   오류 Reason: BadCharacter / MaxLevel / NotEnoughBooks / Conflict
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId, parseBody } from './friendStore';
import { BOOK_ID, BOOKS_TO_LEVEL, MAX_SKILL_LEVEL, isCharacter } from './gearCatalog';
import { PLAYER_TABLE, readPlayerGear, revGuard, skillLevelOf, toClientGear } from './gearStore';

const client = new DynamoDBClient({ region: process.env.REGION });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const characterId = parseBody<{ CharacterId?: string }>(event.body)?.CharacterId;
  if (!isCharacter(characterId)) return createErrorResponse(400, 'Bad character', { Reason: 'BadCharacter' });

  try {
    const row = await readPlayerGear(me);
    if (!row.Exists) return createErrorResponse(404, 'Player not found', { Reason: 'NoPlayer' });
    const cur = skillLevelOf(row, characterId);
    if (cur >= MAX_SKILL_LEVEL) return createErrorResponse(409, 'Max level', { Reason: 'MaxLevel' });
    const need = BOOKS_TO_LEVEL[cur + 1] ?? 99;
    const have = row.Items[BOOK_ID] ?? 0;
    if (have < need) return createErrorResponse(409, 'Not enough books', { Reason: 'NotEnoughBooks', Need: need, Have: have });
    const levels = { ...row.SkillLevels, [characterId]: cur + 1 };
    const g = revGuard(row);
    try {
      await client.send(
        new UpdateItemCommand({
          TableName: PLAYER_TABLE,
          Key: marshall({ PlayerID: me }),
          UpdateExpression: 'SET #items.#book = :left, SkillLevels = :levels, GearRev = :rev1, UpdatedAt = :now',
          ConditionExpression: `attribute_exists(PlayerID) AND #items.#book = :have AND ${g.cond}`,
          ExpressionAttributeNames: { '#items': 'Items', '#book': BOOK_ID },
          ExpressionAttributeValues: marshall({ ':left': have - need, ':have': have, ':levels': levels, ':now': new Date().toISOString(), ...g.values }),
        })
      );
    } catch (e) {
      if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return createErrorResponse(409, 'Try again', { Reason: 'Conflict' });
      throw e;
    }
    console.log(`[LevelSkill] ${me} ${characterId} ${cur} -> ${cur + 1} books ${have} -> ${have - need}`);
    return createSuccessResponse({ Leveled: { CharacterId: characterId, Level: cur + 1, BooksUsed: need }, ...toClientGear(await readPlayerGear(me)) });
  } catch (e) {
    console.error('[LevelSkill]', e);
    return createErrorResponse(500, 'Failed to level');
  }
};
