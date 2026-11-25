// ========================================
// gearStore.ts - 장비 · 스킬 레벨 읽기/쓰기 (장비 · 스킬 G1, 2026-11-25)
//   PlayerResources: Items(개수 — 장비 · 스킬 책), EquippedGear { "Char_001#Weapon": ItemId }, SkillLevels { Char_001: 2 }, Credits
//   EquippedGear · SkillLevels 는 맵 통째로 바꾼다 — 조건 '읽은 값 그대로'(동시에 두 번 바꿀 때 하나가 덮어쓰지 않게)
// ========================================
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  BOOK_ID,
  BOOKS_TO_LEVEL,
  CHARACTERS,
  GEAR,
  MAX_GEAR_COUNT,
  MAX_SKILL_LEVEL,
  SLOTS,
  type GearSlot,
} from './gearCatalog';

export const PLAYER_TABLE = 'PlayerResources';
const client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });

export interface PlayerGearRow {
  Exists: boolean;
  Items: Record<string, number>;
  Credits: number;
  Equipped: Record<string, string>; // "Char_001#Weapon" → ItemId (원본 맵 그대로)
  bHasEquipped: boolean; // EquippedGear 속성이 있었나 (조건식용)
  SkillLevels: Record<string, number>;
  bHasSkillLevels: boolean;
  Rev: number | undefined; // GearRev — 장착 · 스킬 레벨을 바꿀 때마다 +1 (조건식으로 겹친 쓰기를 막는다)
}

export async function readPlayerGear(playerId: string): Promise<PlayerGearRow> {
  const r = await client.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: playerId }),
      ProjectionExpression: 'PlayerID, #items, Credits, EquippedGear, SkillLevels, GearRev',
      ExpressionAttributeNames: { '#items': 'Items' }, // Items 는 DynamoDB 예약어
      ConsistentRead: true,
    })
  );
  const p = r.Item ? unmarshall(r.Item) : {};
  const items: Record<string, number> = {};
  for (const [k, v] of Object.entries((p.Items as Record<string, unknown>) ?? {})) items[k] = Number(v) || 0;
  const equipped: Record<string, string> = {};
  for (const [k, v] of Object.entries((p.EquippedGear as Record<string, unknown>) ?? {})) if (typeof v === 'string' && v) equipped[k] = v;
  const levels: Record<string, number> = {};
  for (const [k, v] of Object.entries((p.SkillLevels as Record<string, unknown>) ?? {})) levels[k] = Math.max(1, Math.min(MAX_SKILL_LEVEL, Number(v) || 1));
  return {
    Exists: !!r.Item,
    Items: items,
    Credits: Number(p.Credits) || 0,
    Equipped: equipped,
    bHasEquipped: p.EquippedGear !== undefined,
    SkillLevels: levels,
    bHasSkillLevels: p.SkillLevels !== undefined,
    Rev: p.GearRev === undefined ? undefined : Number(p.GearRev) || 0,
  };
}

/** 그 장비를 지금 끼고 있는 캐릭터 수 (except = 이 칸은 빼고 센다 — 같은 칸을 바꿔 낄 때) */
export function wearingCount(equipped: Record<string, string>, itemId: string, exceptKey?: string): number {
  let n = 0;
  for (const [k, v] of Object.entries(equipped)) if (v === itemId && k !== exceptKey) n++;
  return n;
}

export const skillLevelOf = (row: PlayerGearRow, characterId: string) => row.SkillLevels[characterId] ?? 1;

/** GearRev 조건: 읽은 뒤 장착 · 스킬 레벨이 바뀌지 않았어야 한다. names/values 에 넣을 것과 다음 값 */
export function revGuard(row: PlayerGearRow) {
  return row.Rev === undefined
    ? { cond: 'attribute_not_exists(GearRev)', values: { ':rev1': 1 } as Record<string, unknown> }
    : { cond: 'GearRev = :rev', values: { ':rev': row.Rev, ':rev1': row.Rev + 1 } as Record<string, unknown> };
}

/** 클라이언트용: 장비 정의 · 가진 수 · 캐릭터마다 칸 셋 · 스킬 레벨 · 책 */
export function toClientGear(row: PlayerGearRow) {
  const equipped: Record<string, Record<GearSlot, string>> = {};
  for (const c of CHARACTERS) {
    const slots = {} as Record<GearSlot, string>;
    for (const s of SLOTS) slots[s] = row.Equipped[`${c}#${s}`] ?? '';
    equipped[c] = slots;
  }
  const levels: Record<string, number> = {};
  for (const c of CHARACTERS) levels[c] = row.SkillLevels[c] ?? 1;
  return {
    Gear: GEAR.map((g) => ({
      ItemId: g.ItemId,
      Slot: g.Slot,
      Rarity: g.Rarity,
      Name: g.Name,
      Desc: g.Desc,
      Stats: g.Stats,
      Price: g.Price,
      Level: g.Level,
      Count: row.Items[g.ItemId] ?? 0,
      Wearing: wearingCount(row.Equipped, g.ItemId),
    })),
    Equipped: equipped,
    SkillLevels: levels,
    Books: row.Items[BOOK_ID] ?? 0,
    BookId: BOOK_ID,
    BooksToLevel: BOOKS_TO_LEVEL,
    MaxSkillLevel: MAX_SKILL_LEVEL,
    MaxGearCount: MAX_GEAR_COUNT,
    Credits: row.Credits,
  };
}
