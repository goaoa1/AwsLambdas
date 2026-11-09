// ========================================
// storyCatalog.ts - 스토리(캐릭터 시나리오) 해금 보상 (2026-11-09)
//   클라이언트 Content/Story/char00X.json 의 에피소드 unlocks[] 에 든 id 가운데 실제 보상이 있는 것만 여기 적는다.
//   claim-story-unlock 이 이 표로 지급하고, 상점은 STORY_SHOP_UNLOCKS 로 의상을 잠근다.
// ========================================
export interface StoryReward {
  Items?: Record<string, number>; // itemCatalog.ts 의 ItemId → 개수
  Outfit?: string;                // shopCatalog.ts 의 OutfitId (OwnedOutfits 에 더함)
  Credits?: number;
}

export const STORY_REWARDS: Record<string, StoryReward> = {
  potion_reaction: { Items: { Item_StaminaS: 1 } },   // 서윤 8화 '매점': 작은 물약 1개
  tie_reward: { Outfit: 'Outfit_Acc_Necktie' },       // 서윤 15화 '만점': 부장 넥타이
};

export function findStoryReward(unlockId: string | undefined): StoryReward | undefined {
  return unlockId ? STORY_REWARDS[unlockId] : undefined;
}
