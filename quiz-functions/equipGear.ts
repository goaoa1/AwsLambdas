// ========================================
// equipGear.ts - POST /equip-gear { CharacterId, Slot: Weapon|Armor|Accessory, ItemId: "" 이면 빼기 } (장비 · 스킬 G1, 2026-11-25)
//   공격 스킬 셋 (2026-11-27 — 게임 Docs §88): { CharacterId, Skills: ["blast", …] } 이면 그 캐릭터의 SkillLoadout 을 통째로 (MAX_SKILLS 까지, 빈 배열 = 다 빼기)
//     오류 Reason: TooManySkills / UnknownSkill / Conflict. 응답 { SkillsSet: { CharacterId, Skills }, ...get-gear 와 같은 것 }
//   서버가 확인: 캐릭터 · 칸 · 장비가 그 칸의 것인지 · 가진 수 · 같은 장비를 낀 다른 캐릭터 수 < 가진 수
//   EquippedGear 맵을 통째로 바꾼다 (조건: GearRev 그대로 — 동시에 두 번 바꿀 때 하나가 덮어쓰지 않게)
//   오류 Reason: BadCharacter / BadSlot / UnknownItem / WrongSlot / NotOwned / AllInUse / Conflict
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId, parseBody } from './friendStore';
import { findGear, gearKey, isCharacter, isSkillId, isSlot, MAX_SKILLS } from './gearCatalog';
import { PLAYER_TABLE, readPlayerGear, revGuard, toClientGear, wearingCount } from './gearStore';

const client = new DynamoDBClient({ region: process.env.REGION });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const body = parseBody<{ CharacterId?: string; Slot?: string; ItemId?: string; Skills?: unknown }>(event.body);
  const characterId = body?.CharacterId;
  const slot = body?.Slot;
  if (!isCharacter(characterId)) return createErrorResponse(400, 'Bad character', { Reason: 'BadCharacter' });
  const skills = body?.Skills;
  if (Array.isArray(skills)) return equipSkills(me, characterId, skills);
  if (!isSlot(slot)) return createErrorResponse(400, 'Bad slot', { Reason: 'BadSlot' });
  const itemId = String(body?.ItemId ?? '').trim();
  const key = gearKey(characterId, slot);

  try {
    const row = await readPlayerGear(me);
    if (!row.Exists) return createErrorResponse(404, 'Player not found', { Reason: 'NoPlayer' });
    const next = { ...row.Equipped };
    if (itemId) {
      const gear = findGear(itemId);
      if (!gear) return createErrorResponse(400, 'Unknown item', { Reason: 'UnknownItem' });
      if (gear.Slot !== slot) return createErrorResponse(400, 'Wrong slot', { Reason: 'WrongSlot' });
      const owned = row.Items[itemId] ?? 0;
      if (owned < 1) return createErrorResponse(409, 'Not owned', { Reason: 'NotOwned' });
      if (wearingCount(row.Equipped, itemId, key) >= owned) return createErrorResponse(409, 'All in use', { Reason: 'AllInUse' });
      next[key] = itemId;
    } else {
      delete next[key];
    }
    if ((next[key] ?? '') !== (row.Equipped[key] ?? '')) {
      const g = revGuard(row);
      try {
        await client.send(
          new UpdateItemCommand({
            TableName: PLAYER_TABLE,
            Key: marshall({ PlayerID: me }),
            UpdateExpression: 'SET EquippedGear = :eq, GearRev = :rev1, UpdatedAt = :now',
            ConditionExpression: `attribute_exists(PlayerID) AND ${g.cond}`,
            ExpressionAttributeValues: marshall({ ':eq': next, ':now': new Date().toISOString(), ...g.values }),
          })
        );
      } catch (e) {
        if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return createErrorResponse(409, 'Try again', { Reason: 'Conflict' });
        throw e;
      }
      console.log(`[EquipGear] ${me} ${key} ${row.Equipped[key] ?? '-'} -> ${next[key] ?? '-'}`);
    }
    return createSuccessResponse({ Equip: { CharacterId: characterId, Slot: slot, ItemId: next[key] ?? '' }, ...toClientGear(await readPlayerGear(me)) });
  } catch (e) {
    console.error('[EquipGear]', e);
    return createErrorResponse(500, 'Failed to equip');
  }
};

// 공격 스킬 셋 (Docs §88): 차례를 지켜 겹친 것은 하나로, MAX_SKILLS 넘으면 거절
async function equipSkills(me: string, characterId: string, raw: unknown[]): Promise<APIGatewayProxyResult> {
  const ids = [...new Set(raw.map((v) => String(v ?? '').trim()).filter((v) => v))];
  if (ids.length > MAX_SKILLS) return createErrorResponse(400, 'Too many skills', { Reason: 'TooManySkills' });
  if (ids.some((id) => !isSkillId(id))) return createErrorResponse(400, 'Unknown skill', { Reason: 'UnknownSkill' });
  try {
    const row = await readPlayerGear(me);
    if (!row.Exists) return createErrorResponse(404, 'Player not found', { Reason: 'NoPlayer' });
    const before = row.SkillLoadout[characterId];
    if (!before || before.join(',') !== ids.join(',')) {
      const next = { ...row.SkillLoadout, [characterId]: ids };
      const g = revGuard(row);
      try {
        await client.send(
          new UpdateItemCommand({
            TableName: PLAYER_TABLE,
            Key: marshall({ PlayerID: me }),
            UpdateExpression: 'SET SkillLoadout = :lo, GearRev = :rev1, UpdatedAt = :now',
            ConditionExpression: `attribute_exists(PlayerID) AND ${g.cond}`,
            ExpressionAttributeValues: marshall({ ':lo': next, ':now': new Date().toISOString(), ...g.values }),
          })
        );
      } catch (e) {
        if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return createErrorResponse(409, 'Try again', { Reason: 'Conflict' });
        throw e;
      }
      console.log(`[EquipGear] ${me} skills ${characterId} ${before ? before.join(',') : '(default)'} -> ${ids.join(',') || '(none)'}`);
    }
    return createSuccessResponse({ SkillsSet: { CharacterId: characterId, Skills: ids }, ...toClientGear(await readPlayerGear(me)) });
  } catch (e) {
    console.error('[EquipGear] skills', e);
    return createErrorResponse(500, 'Failed to set skills');
  }
}
