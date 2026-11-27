// ========================================
// gearCatalog.ts - 전투 장비 · 스킬 책 (장비 · 스킬 G1, 2026-11-25 — 게임 저장소 Docs/장비_스킬_계획.md). 숫자는 이 파일만 고친다.
//   사용자: "캐릭터 장비 시스템 구축 / 캐릭터 스킬 시스템 구축 / 둘 다 하자"
//     장비 = 무기 · 방어구 · 장신구 3칸(캐릭터마다), 얻기 = 전투 보상 + 상점(크레딧), 강화 없음(자리만)
//     스킬 = 캐릭터마다 자기 스킬 레벨업(1 ~ 5), 올리는 것 = 전투 보상 '스킬 책'
//   보관: PlayerResources.Items(물약과 같은 맵 — 개수), EquippedGear { "Char_001#Weapon": ItemId }, SkillLevels { Char_001: 2 }
//   능력은 전투(기기)가 쓴다: Power = 주문 위력(한 발 × (1 + Power)), Hp = 체력 +, Guard = 받는 피해 × (1 − Guard),
//   Recite = 암송 시간 +초, Mana = 마력 × (1 + Mana), Resonance = 공명 게이지 × (1 + Resonance)
// ========================================

export type GearSlot = 'Weapon' | 'Armor' | 'Accessory';
export type GearRarity = 'Common' | 'Rare' | 'Epic'; // 일반 · 고급 · 희귀

export interface GearStats {
  Power?: number;
  Hp?: number;
  Guard?: number;
  Recite?: number;
  Mana?: number;
  Resonance?: number;
}

export interface GearDef {
  ItemId: string;
  Slot: GearSlot;
  Rarity: GearRarity;
  Name: string;
  Desc: string;
  Stats: GearStats;
  Price: number; // 크레딧. 0 이면 상점에서 팔지 않음 (전투에서만)
  Level: number; // 강화 자리 (지금은 늘 0 — 강화 없음, 사용자 2026-11-25)
}

export const CHARACTERS = ['Char_001', 'Char_002', 'Char_003', 'Char_004'];
export const SLOTS: GearSlot[] = ['Weapon', 'Armor', 'Accessory'];
export const MAX_GEAR_COUNT = 4; // 장비 하나를 가질 수 있는 수 (캐릭터 수만큼 — 넷이 같은 것을 낄 수 있게)

export const BOOK_ID = 'Book_Skill';
export const BOOK_NAME = '스킬 책';
export const MAX_BOOK_COUNT = 99;
export const MAX_SKILL_LEVEL = 5;
// [레벨] = 그 레벨로 올리는 데 드는 스킬 책 (Lv2 1 · Lv3 2 · Lv4 3 · Lv5 4, 모두 10권)
export const BOOKS_TO_LEVEL = [0, 0, 1, 2, 3, 4];

// 공격 스킬 셋 (2026-11-27 — 게임 저장소 Docs/퀴즈맵_전투_개편_계획.md §88, 사용자: "모으기 기능을 없애고 스킬 버튼을 만들자 … 스킬은 최대 3개까지 장착할 수 있다"
//   · 고른 것: 새 공격 스킬 여섯 · 서버에 저장 · 레벨은 지금 없앰). 스킬의 숫자(마력 · 세기)는 게임 waves.json skills — 서버는 아이디와 장착 수만 본다.
//   보관: PlayerResources.SkillLoadout { Char_001: ["barrage", "lance", "chain"] } (차례 = 전투 단추 차례). 없는 캐릭터는 DEFAULT_SKILLS
export const SKILL_IDS = ['blast', 'chain', 'lance', 'barrage', 'meteor', 'frost'];
export const MAX_SKILLS = 3;
// 고른 적이 없을 때 (게임 waves.json skill_loadout.default 와 같게)
export const DEFAULT_SKILLS: Record<string, string[]> = {
  Char_001: ['barrage', 'lance', 'chain'],
  Char_002: ['meteor', 'blast', 'frost'],
  Char_003: ['blast', 'lance', 'barrage'],
  Char_004: ['chain', 'frost', 'lance'],
};

export const GEAR: GearDef[] = [
  { ItemId: 'Gear_W_Branch', Slot: 'Weapon', Rarity: 'Common', Name: '나뭇가지 지팡이', Desc: '주문 위력 +10%', Stats: { Power: 0.1 }, Price: 120, Level: 0 },
  { ItemId: 'Gear_W_Oak', Slot: 'Weapon', Rarity: 'Rare', Name: '참나무 지팡이', Desc: '주문 위력 +20%', Stats: { Power: 0.2 }, Price: 300, Level: 0 },
  { ItemId: 'Gear_W_Star', Slot: 'Weapon', Rarity: 'Epic', Name: '별빛 지팡이', Desc: '주문 위력 +35%', Stats: { Power: 0.35 }, Price: 0, Level: 0 },
  { ItemId: 'Gear_A_Cloak', Slot: 'Armor', Rarity: 'Common', Name: '누빈 망토', Desc: '체력 +20', Stats: { Hp: 20 }, Price: 100, Level: 0 },
  { ItemId: 'Gear_A_Robe', Slot: 'Armor', Rarity: 'Rare', Name: '견습생 로브', Desc: '체력 +35, 받는 피해 −10%', Stats: { Hp: 35, Guard: 0.1 }, Price: 280, Level: 0 },
  { ItemId: 'Gear_A_Silver', Slot: 'Armor', Rarity: 'Epic', Name: '은실 로브', Desc: '체력 +50, 받는 피해 −20%', Stats: { Hp: 50, Guard: 0.2 }, Price: 0, Level: 0 },
  { ItemId: 'Gear_C_Bell', Slot: 'Accessory', Rarity: 'Common', Name: '박자 방울', Desc: '암송 시간 +0.5초', Stats: { Recite: 0.5 }, Price: 150, Level: 0 },
  { ItemId: 'Gear_C_Ring', Slot: 'Accessory', Rarity: 'Rare', Name: '마력 반지', Desc: '마력 +25%', Stats: { Mana: 0.25 }, Price: 260, Level: 0 },
  { ItemId: 'Gear_C_Pendant', Slot: 'Accessory', Rarity: 'Epic', Name: '공명 목걸이', Desc: '공명이 30% 빨리 찬다', Stats: { Resonance: 0.3 }, Price: 0, Level: 0 },
];

// 전투 보상 (finish-battle — 의뢰 완료 · 믿을 수 있는 판만). 난이도 → 스킬 책 · 장비 확률
//   2026-11-27 (Docs §88 — 스킬 레벨을 없앰): 스킬 책은 나오지 않는다. 되살리면 BookChance 0.4 · 0.7 · 1 · 1, veryhard ExtraBookChance 0.5
export const REWARD_BY_DIFFICULTY: Record<string, { BookChance: number; ExtraBookChance: number; GearChance: number }> = {
  easy: { BookChance: 0, ExtraBookChance: 0, GearChance: 0.08 },
  normal: { BookChance: 0, ExtraBookChance: 0, GearChance: 0.15 },
  hard: { BookChance: 0, ExtraBookChance: 0, GearChance: 0.25 },
  veryhard: { BookChance: 0, ExtraBookChance: 0, GearChance: 0.4 },
};
export const BOSS_GEAR_BONUS = 0.1; // 보스를 쓰러뜨렸으면 장비 확률 +10%p
// 권(단)에 따라 나오는 등급의 비율 — 단 = 10 + QuizID
export function rarityWeights(volume: number): Record<GearRarity, number> {
  if (volume >= 17) return { Common: 0.4, Rare: 0.4, Epic: 0.2 };
  if (volume >= 14) return { Common: 0.7, Rare: 0.3, Epic: 0 };
  return { Common: 1, Rare: 0, Epic: 0 };
}

export function findGear(id: string | undefined): GearDef | undefined {
  return id ? GEAR.find((g) => g.ItemId === id) : undefined;
}
export function isCharacter(id: unknown): id is string {
  return typeof id === 'string' && CHARACTERS.includes(id);
}
export function isSkillId(id: unknown): id is string {
  return typeof id === 'string' && SKILL_IDS.includes(id);
}
export function isSlot(s: unknown): s is GearSlot {
  return typeof s === 'string' && (SLOTS as string[]).includes(s);
}
export const gearKey = (characterId: string, slot: GearSlot) => `${characterId}#${slot}`;
export const ITEM_DISPLAY_NAME = (id: string) => (id === BOOK_ID ? BOOK_NAME : findGear(id)?.Name ?? id);
