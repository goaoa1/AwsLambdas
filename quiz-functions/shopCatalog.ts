// ========================================
// shopCatalog.ts - 상점 카탈로그 (서버가 기준값을 가진다)
// 클라이언트 데이터 에셋(DA_Outfit_*)의 OutfitId / 크레딧 상품 ProductId 와 반드시 일치해야 한다.
// 값이 바뀌면 get-shop 응답으로 내려가므로 클라이언트는 여기 가격을 그대로 표시한다.
// ========================================

export interface OutfitEntry {
  OutfitId: string;
  Price: number;        // 크레딧
  Characters: string[]; // 입을 수 있는 캐릭터. 비어 있으면 모든 캐릭터
}

export interface CreditPackEntry {
  ProductId: string;    // Google Play 인앱 상품 ID (소모성)
  Credits: number;      // 지급 크레딧
  BonusCredits: number; // 표시용 보너스(지급 크레딧에 이미 포함)
}

export const OUTFITS: OutfitEntry[] = [
  { OutfitId: 'Outfit_Navy',   Price: 300,  Characters: ['Char_003', 'Char_001'] },
  { OutfitId: 'Outfit_Summer', Price: 450,  Characters: ['Char_003'] },
  { OutfitId: 'Outfit_Formal', Price: 800,  Characters: [] },
];

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
