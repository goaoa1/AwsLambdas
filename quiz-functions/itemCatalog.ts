// ========================================
// itemCatalog.ts - 아이템 목록 (아이템 인벤토리 1단계, 2026-11-08). 숫자는 이 파일만 고친다.
//   스태미나 아이템: 쓰면 스태미나가 오른다. 최대 10 (MAX_STAMINA) 까지만 → 가득 차 있으면 쓸 수 없다(아이템은 남음).
//   Stamina: 'Full' 이면 10 까지 채운다.
//   얻는 곳: 상점(크레딧, Price), 출석 보너스(claimDailyAttendance.ts), 도전과제 보상(achievementCatalog.ts)
// ========================================

export interface ItemDef {
  ItemId: string;
  Name: string;
  Desc: string;
  Stamina: number | 'Full';
  Price: number;     // 크레딧. 0 이면 상점에서 팔지 않음
}

export const MAX_ITEM_COUNT = 99;
export const MAX_BUY_COUNT = 10; // 한 번에 살 수 있는 수

export const ITEMS: ItemDef[] = [
  { ItemId: 'Item_StaminaS', Name: '작은 물약', Desc: '스태미나 +1', Stamina: 1, Price: 30 },
  { ItemId: 'Item_StaminaL', Name: '큰 물약', Desc: '스태미나 +3', Stamina: 3, Price: 80 },
  { ItemId: 'Item_StaminaFull', Name: '가득 채우기', Desc: '스태미나를 10까지', Stamina: 'Full', Price: 200 },
];

export function findItem(id: string | undefined): ItemDef | undefined {
  return id ? ITEMS.find((i) => i.ItemId === id) : undefined;
}

export const ITEM_NAME = (id: string) => findItem(id)?.Name ?? id;
