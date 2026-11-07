// ========================================
// shopCatalog.ts - 상점 카탈로그 (서버가 기준값을 가진다)
// 클라이언트 데이터 에셋(DA_Outfit_*)의 OutfitId / 크레딧 상품 ProductId 와 반드시 일치해야 한다.
// 값이 바뀌면 get-shop 응답으로 내려가므로 클라이언트는 여기 가격을 그대로 표시한다.
// ========================================

// 의상이 차지하는 부위. 클라이언트 UOutfitDataAsset::Slot 과 반드시 일치해야 한다.
// 캐릭터는 부위마다 하나씩 입는다: 상의와 하의는 따로, 세트는 상의·하의 자리를 모두 차지한다.
export type OutfitSlot = 'Top' | 'Bottom' | 'Set';

export interface OutfitEntry {
  OutfitId: string;
  Price: number;        // 크레딧
  Characters: string[]; // 입을 수 있는 캐릭터. 비어 있으면 모든 캐릭터
  Slot: OutfitSlot;
}

export interface CreditPackEntry {
  ProductId: string;    // Google Play 인앱 상품 ID (소모성)
  Credits: number;      // 지급 크레딧
  BonusCredits: number; // 표시용 보너스(지급 크레딧에 이미 포함)
}

export const OUTFITS: OutfitEntry[] = [
  { OutfitId: 'Outfit_Navy',        Price: 300, Characters: ['Char_003', 'Char_001'], Slot: 'Set' },
  { OutfitId: 'Outfit_WhiteBlouse', Price: 350, Characters: ['Char_003'],             Slot: 'Top' },  // 001 피팅은 아직 미완성
  { OutfitId: 'Outfit_PlaidSkirt',  Price: 300, Characters: ['Char_003'],             Slot: 'Bottom' },
  { OutfitId: 'Outfit_Summer',      Price: 450, Characters: ['Char_003'],             Slot: 'Set' },
  { OutfitId: 'Outfit_Formal',      Price: 800, Characters: [],                       Slot: 'Set' },
];

// EquippedOutfits 키: "Char_003#Top" / "Char_003#Bottom" / "Char_003#Set". 부위가 나뉘기 전 옛 키는 "Char_003"
export function splitEquipKey(key: string): { characterId: string; slot: OutfitSlot | '' } {
  const i = key.indexOf('#');
  if (i < 0) return { characterId: key, slot: '' };
  const s = key.slice(i + 1);
  return { characterId: key.slice(0, i), slot: s === 'Top' || s === 'Bottom' ? s : 'Set' };
}

export function slotOf(outfitId: string): OutfitSlot {
  return findOutfit(outfitId)?.Slot ?? 'Set';
}

export function slotsOverlap(a: OutfitSlot, b: OutfitSlot): boolean {
  return a === b || a === 'Set' || b === 'Set';
}

// 입히기: 그 캐릭터의 겹치는 부위 의상을 빼고 새 의상을 넣은 맵을 돌려준다 (옛 키는 부위 키로 옮김)
export function equipInMap(map: Record<string, string>, characterId: string, outfitId: string): Record<string, string> {
  const slot = slotOf(outfitId);
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    const { characterId: c, slot: s } = splitEquipKey(k);
    if (c !== characterId) { next[k] = v; continue; }
    const existing = s === '' ? slotOf(v) : s;
    if (slotsOverlap(existing, slot)) continue;
    next[`${characterId}#${existing}`] = v;
  }
  next[`${characterId}#${slot}`] = outfitId;
  return next;
}

// 벗기기: outfitId 가 빈 문자열이면 그 캐릭터의 의상 전부, 아니면 그 의상만
export function unequipInMap(map: Record<string, string>, characterId: string, outfitId: string): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    const { characterId: c } = splitEquipKey(k);
    if (c === characterId && (outfitId === '' || v === outfitId)) continue;
    next[k] = v;
  }
  return next;
}

export const CREDIT_PACKS: CreditPackEntry[] = [
  { ProductId: 'credits_100',  Credits: 100,  BonusCredits: 0 },
  { ProductId: 'credits_550',  Credits: 550,  BonusCredits: 50 },
  { ProductId: 'credits_1200', Credits: 1200, BonusCredits: 200 },
];

// 개발용 샌드박스 결제(플랫폼 'sandbox')가 허용될 때 한 번에 지급할 수 있는 최대 크레딧
export const SANDBOX_MAX_CREDITS = 1200;

export function findOutfit(outfitId: string): OutfitEntry | undefined {
  return OUTFITS.find((o) => o.OutfitId === outfitId);
}

export function findCreditPack(productId: string): CreditPackEntry | undefined {
  return CREDIT_PACKS.find((p) => p.ProductId === productId);
}

export function outfitFitsCharacter(outfit: OutfitEntry, characterId: string): boolean {
  return outfit.Characters.length === 0 || outfit.Characters.includes(characterId);
}
