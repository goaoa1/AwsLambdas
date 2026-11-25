// ========================================
// gearRewards.ts - 전투 보상: 스킬 책 · 장비 (장비 · 스킬 G1, 2026-11-25 — Docs/장비_스킬_계획.md §2-3)
//   finish-battle 이 의뢰 완료(win)이고 믿을 수 있는 판(Suspicious 아님)일 때 부른다.
//   난이도 → 스킬 책 수 · 장비 확률(보스를 쓰러뜨렸으면 +10%p), 권(단 = 10 + QuizID) → 나오는 등급.
//   이미 4개 가진 장비는 나오지 않는다(같은 등급의 다른 것 → 나올 수 있는 다른 등급 → 다 가졌으면 스킬 책 1권).
// ========================================
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import {
  BOOK_ID,
  BOOK_NAME,
  BOSS_GEAR_BONUS,
  GEAR,
  MAX_BOOK_COUNT,
  MAX_GEAR_COUNT,
  REWARD_BY_DIFFICULTY,
  rarityWeights,
  type GearRarity,
} from './gearCatalog';
import { PLAYER_TABLE, ensureItemsMap, grantItemsExpression, readPlayerItems } from './inventoryStore';

const client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });

export interface RewardLine {
  ItemId: string;
  Name: string;
  Kind: 'Gear' | 'Book';
  Count: number;
  Slot?: string;
  Rarity?: string;
}

/** 보상 굴리기 (DB 안 씀 — 시험하기 쉽게). current = 지금 가진 수 */
export function rollBattleRewards(
  difficulty: string,
  quizId: string,
  bossDown: boolean,
  current: Record<string, number>,
  rnd: () => number = Math.random
): { grants: Record<string, number>; lines: RewardLine[] } {
  const cfg = REWARD_BY_DIFFICULTY[difficulty] ?? REWARD_BY_DIFFICULTY.normal;
  let books = 0;
  if (rnd() < cfg.BookChance) books++;
  if (cfg.ExtraBookChance > 0 && rnd() < cfg.ExtraBookChance) books++;
  let gearId: string | undefined;
  if (rnd() < Math.min(1, cfg.GearChance + (bossDown ? BOSS_GEAR_BONUS : 0))) {
    const volume = 10 + (Number(quizId) || 1);
    const w = rarityWeights(volume);
    let r = rnd();
    let rarity: GearRarity = 'Common';
    for (const k of ['Common', 'Rare', 'Epic'] as GearRarity[]) {
      if (r < w[k]) {
        rarity = k;
        break;
      }
      r -= w[k];
    }
    const notFull = (id: string) => (current[id] ?? 0) < MAX_GEAR_COUNT;
    let pool = GEAR.filter((g) => g.Rarity === rarity && notFull(g.ItemId));
    if (!pool.length) pool = GEAR.filter((g) => w[g.Rarity] > 0 && notFull(g.ItemId));
    if (pool.length) gearId = pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))].ItemId;
    else books++; // 나올 수 있는 장비를 다 가졌다 → 스킬 책 1권
  }
  const grants: Record<string, number> = {};
  const lines: RewardLine[] = [];
  if (gearId) {
    const g = GEAR.find((x) => x.ItemId === gearId)!;
    grants[gearId] = 1;
    lines.push({ ItemId: gearId, Name: g.Name, Kind: 'Gear', Count: 1, Slot: g.Slot, Rarity: g.Rarity });
  }
  const bookRoom = Math.max(0, MAX_BOOK_COUNT - (current[BOOK_ID] ?? 0));
  const bookGrant = Math.min(books, bookRoom);
  if (bookGrant > 0) {
    grants[BOOK_ID] = bookGrant;
    lines.push({ ItemId: BOOK_ID, Name: BOOK_NAME, Kind: 'Book', Count: bookGrant });
  }
  return { grants, lines };
}

/** 굴려서 Items 에 넣는다 (읽은 개수 그대로일 때만 — 다른 요청과 겹치면 다시 읽어 다시 굴림, 세 번까지) */
export async function grantBattleRewards(playerId: string, difficulty: string, quizId: string, bossDown: boolean): Promise<RewardLine[]> {
  await ensureItemsMap(playerId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await readPlayerItems(playerId);
    const { grants, lines } = rollBattleRewards(difficulty, quizId, bossDown, row.Items);
    if (!lines.length) return [];
    const ex = grantItemsExpression(grants, row.Items, 'r');
    if (!ex.sets.length) return [];
    try {
      await client.send(
        new UpdateItemCommand({
          TableName: PLAYER_TABLE,
          Key: marshall({ PlayerID: playerId }),
          UpdateExpression: `SET ${ex.sets.join(', ')}`,
          ConditionExpression: ex.conds.join(' AND '),
          ExpressionAttributeNames: ex.names,
          ExpressionAttributeValues: marshall(ex.values),
        })
      );
      return lines;
    } catch (e) {
      if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e;
    }
  }
  return [];
}
