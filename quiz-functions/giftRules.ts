// ========================================
// giftRules.ts - 친구 선물 규칙 (친구 기능 4단계)
//   - 친구마다 하루(한국 날짜) 한 번 스태미나 1 을 보낼 수 있다. 내 줄(나→친구)에 LastGiftDate 를 남긴다.
//   - 받은 선물은 받는 사람 줄(받는 사람→보낸 사람)의 GiftPending 에 쌓인다.
//   - 받기: 스태미나는 최대 MAX_STAMINA(10)까지만 오른다. 들어가지 못한 선물은 그대로 남는다(다음에 받기).
//   스태미나 회복 규칙은 recordPlayerInfo.ts 와 같다 (10분마다 1, 가득 차면 회복 시계 LastStaminaUpdateAt 제거).
// ========================================

export const GIFT_STAMINA = 1;
export const MAX_STAMINA = 10;
export const REGEN_INTERVAL_MS = 10 * 60 * 1000;

export function todayKST(nowMs = Date.now()): string {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 저장된 스태미나에 회복분을 반영한 '지금' 값과 새 회복 시계
export function effectiveStamina(stored: number, lastUpdateAt: number | undefined, nowMs = Date.now()) {
  if (stored >= MAX_STAMINA || lastUpdateAt == null) return { stamina: Math.min(stored, MAX_STAMINA), clock: lastUpdateAt };
  const regen = Math.floor((nowMs - lastUpdateAt) / REGEN_INTERVAL_MS);
  if (regen <= 0) return { stamina: stored, clock: lastUpdateAt };
  const stamina = Math.min(stored + regen, MAX_STAMINA);
  return { stamina, clock: stamina >= MAX_STAMINA ? undefined : lastUpdateAt + regen * REGEN_INTERVAL_MS };
}
