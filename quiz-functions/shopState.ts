// ========================================
// shopState.ts - PlayerResources 의 상점 관련 속성 읽기
//   Credits          N   보유 크레딧
//   OwnedOutfits     L<S> 보유 의상 ID
//   EquippedOutfits  M<S,S> 캐릭터 ID -> 의상 ID
// ========================================

export interface ShopPlayerState {
  Credits: number;
  OwnedOutfits: string[];
  EquippedOutfits: Record<string, string>;
}

export function readShopState(playerData: Record<string, unknown> | undefined): ShopPlayerState {
  const credits = typeof playerData?.Credits === 'number' ? (playerData.Credits as number) : 0;
  const owned = Array.isArray(playerData?.OwnedOutfits)
    ? (playerData!.OwnedOutfits as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const equippedRaw = playerData?.EquippedOutfits;
  const equipped: Record<string, string> = {};
  if (equippedRaw && typeof equippedRaw === 'object') {
    for (const [k, v] of Object.entries(equippedRaw as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 0) equipped[k] = v;
    }
  }
  return { Credits: credits, OwnedOutfits: owned, EquippedOutfits: equipped };
}
