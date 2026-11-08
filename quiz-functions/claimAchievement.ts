// ========================================
// claimAchievement.ts - POST /claim-achievement { AchievementId }
//   다음 단계 하나를 받는다 (단계는 차례대로). 한 트랜잭션에서:
//     PlayerAchievements.ClaimedTiers  n → n+1 (조건: 지금 n 이어야 함 → 두 번 받기 방지)
//     PlayerResources                  Credits 더하기, Stamina 는 회복분 포함 최대 10까지 (선물 받기와 같은 규칙)
//   칭호는 받은 단계에서 계산하므로 따로 저장하지 않는다 (3단계에서 장착).
//   오류 Reason: UnknownAchievement / NotReached / AllClaimed / Locked(준비 중 보상) / StaminaFull / Conflict
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId, parseBody } from './friendStore';
import { findAchievement, tierLocked, tierReached, TITLES } from './achievementCatalog';
import { ACHIEVEMENT_TABLE, PLAYER_TABLE, buildAchievementList, computeStats, readClaimed } from './achievementProgress';
import { MAX_STAMINA, effectiveStamina } from './giftRules';
import { ensureItemsMap, grantItemsExpression } from './inventoryStore';
import { ITEM_NAME } from './itemCatalog';

const client = new DynamoDBClient({ region: process.env.REGION });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const body = parseBody<{ AchievementId?: string }>(event.body);
  const a = body?.AchievementId ? findAchievement(body.AchievementId) : undefined;
  if (!a) return createErrorResponse(400, 'Unknown achievement', { Reason: 'UnknownAchievement' });

  const [stats, claimedMap] = await Promise.all([computeStats(me), readClaimed(me)]);
  const claimed = claimedMap.get(a.Id) ?? 0;
  if (claimed >= a.Tiers.length) return createErrorResponse(409, 'All tiers claimed', { Reason: 'AllClaimed' });
  const tier = a.Tiers[claimed];
  if (tierLocked(tier)) return createErrorResponse(409, 'Reward not ready yet', { Reason: 'Locked' });
  if (!tierReached(a, stats[a.Stat], tier)) return createErrorResponse(409, 'Goal not reached', { Reason: 'NotReached' });

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const items: NonNullable<ConstructorParameters<typeof TransactWriteItemsCommand>[0]>['TransactItems'] = [
    {
      Update: {
        TableName: ACHIEVEMENT_TABLE,
        Key: marshall({ PlayerID: me, AchievementId: a.Id }),
        UpdateExpression: 'SET ClaimedTiers = :next, LastClaimedAt = :now',
        ConditionExpression: claimed === 0 ? 'attribute_not_exists(ClaimedTiers) OR ClaimedTiers = :cur' : 'ClaimedTiers = :cur',
        ExpressionAttributeValues: marshall({ ':next': claimed + 1, ':cur': claimed, ':now': nowIso }),
      },
    },
  ];

  const credits = tier.Reward.Credits ?? 0;
  const staminaReward = tier.Reward.Stamina ?? 0;
  const itemReward = tier.Reward.Items ?? {};
  const hasItems = Object.values(itemReward).some((n) => n > 0);
  let staminaGranted = 0;
  let itemsGranted: Record<string, number> = {};
  if (credits > 0 || staminaReward > 0 || hasItems) {
    const sets: string[] = ['UpdatedAt = :now'];
    const removes: string[] = [];
    const values: Record<string, unknown> = { ':now': nowIso };
    const conds: string[] = ['attribute_exists(PlayerID)'];
    let names: Record<string, string> | undefined;
    if (hasItems) {
      await ensureItemsMap(me);
      const r = await client.send(
        new GetItemCommand({ TableName: PLAYER_TABLE, Key: marshall({ PlayerID: me }), ProjectionExpression: '#items', ExpressionAttributeNames: { '#items': 'Items' } })
      );
      const cur: Record<string, number> = {};
      for (const [k, v] of Object.entries(((r.Item ? unmarshall(r.Item) : {}).Items as Record<string, unknown>) ?? {})) cur[k] = Number(v) || 0;
      const g = grantItemsExpression(itemReward, cur, 'i');
      sets.push(...g.sets);
      conds.push(...g.conds);
      Object.assign(values, g.values);
      names = g.names;
      itemsGranted = g.granted;
    }
    if (credits > 0) {
      sets.push('Credits = if_not_exists(Credits, :zero) + :credits');
      values[':credits'] = credits;
      values[':zero'] = 0;
    }
    if (staminaReward > 0) {
      const r = await client.send(
        new GetItemCommand({
          TableName: PLAYER_TABLE,
          Key: marshall({ PlayerID: me }),
          ProjectionExpression: 'Stamina, LastStaminaUpdateAt',
        })
      );
      const p = r.Item ? unmarshall(r.Item) : {};
      const stored = Number(p.Stamina) || 0;
      const eff = effectiveStamina(stored, p.LastStaminaUpdateAt as number | undefined, now);
      if (eff.stamina >= MAX_STAMINA) {
        return createErrorResponse(409, 'Stamina is full', { Reason: 'StaminaFull' });
      }
      const next = Math.min(MAX_STAMINA, eff.stamina + staminaReward);
      staminaGranted = next - eff.stamina;
      sets.push('Stamina = :stamina');
      values[':stamina'] = next;
      values[':stored'] = stored;
      conds.push('(Stamina = :stored OR attribute_not_exists(Stamina))');
      if (next >= MAX_STAMINA) removes.push('LastStaminaUpdateAt');
      else {
        sets.push('LastStaminaUpdateAt = :clock');
        values[':clock'] = eff.clock ?? now;
      }
    }
    items.push({
      Update: {
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: me }),
        UpdateExpression: `SET ${sets.join(', ')}${removes.length ? ' REMOVE ' + removes.join(', ') : ''}`,
        ConditionExpression: conds.join(' AND '),
        ...(names && Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
        ExpressionAttributeValues: marshall(values),
      },
    });
  }

  try {
    await client.send(new TransactWriteItemsCommand({ TransactItems: items }));
  } catch (e) {
    if ((e as { name?: string }).name === 'TransactionCanceledException') {
      console.warn('[ClaimAchievement] conflict', me, a.Id, (e as { CancellationReasons?: unknown }).CancellationReasons);
      return createErrorResponse(409, 'Try again', { Reason: 'Conflict' });
    }
    console.error('[ClaimAchievement]', e);
    return createErrorResponse(500, 'Failed to claim');
  }

  console.log(`[ClaimAchievement] ${me} ${a.Id} tier ${claimed + 1}/${a.Tiers.length} credits=${credits} stamina=${staminaGranted}`);
  return createSuccessResponse({
    Claimed: {
      AchievementId: a.Id,
      Tier: claimed + 1,
      Credits: credits,
      Stamina: staminaGranted,
      Title: tier.Reward.Title ?? '',
      TitleName: tier.Reward.Title ? TITLES[tier.Reward.Title] ?? '' : '',
      Items: Object.entries(itemsGranted).map(([ItemId, Count]) => ({ ItemId, Name: ITEM_NAME(ItemId), Count })),
    },
    ...(await buildAchievementList(me)),
  });
};
