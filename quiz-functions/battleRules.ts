// ========================================
// battleRules.ts - 전투 판(「산술사」) 서버 규칙 (전투 개편 S7, 2026-11-24)
//   게임 문서: TimesTable/Docs/퀴즈맵_전투_개편_계획.md §34 · Docs/전투_모드_안내.md
//   입장(start-battle): 스태미나 1 + 판 번호(BattleId). 판은 PlayerResources.BattleSession 맵 하나에 적는다 —
//     교실 판 세션(ActiveQuizSessions · 이어하기)과 섞지 않는다.
//   전투 계산(마물 · 결계 · 룬)은 기기가 하고, 서버는 끝(S7b)에서 판 번호 · 시간 · 맞힌 수로 낼 수 있는 범위만 본다.
//   스태미나 회복 규칙은 giftRules.ts(= recordPlayerInfo.ts)와 같다 — 저장값에 회복분을 더한 '지금' 값에서 뺀다.
// ========================================
import { effectiveStamina, MAX_STAMINA, REGEN_INTERVAL_MS } from './giftRules';
import { parseDifficulty, type Difficulty } from './difficulty';

export const BATTLE_STAMINA_COST = 1;

export interface BattleStartRequest {
  quizId: string;
  difficulty: Difficulty;
  requestId: string;
}

// 전투 판은 단 퀴즈(1~9 = 11~19단)만. 난이도가 없거나 모르면 쉬움 (기기 UBattleRoundSubsystem::BeginRound 와 같음)
// RequestId: 기기가 입장 한 번마다 만드는 uuid — 응답을 못 받아 같은 요청을 다시 보내도 스태미나를 두 번 쓰지 않게
export function parseStartRequest(body: unknown): BattleStartRequest | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const quizId = typeof b.QuizID === 'string' ? b.QuizID : typeof b.QuizID === 'number' ? String(b.QuizID) : '';
  if (!/^[1-9]$/.test(quizId)) return 'Bad QuizID';
  const requestId = typeof b.RequestId === 'string' ? b.RequestId : '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) return 'Bad RequestId';
  return { quizId, difficulty: parseDifficulty(b.Difficulty) ?? 'easy', requestId };
}

export interface StaminaPlan {
  ok: boolean;
  before: number; // 회복분을 더한 지금 값
  after: number; // 쓴 뒤 값 (모자라면 before 그대로)
  clock?: number; // 쓴 뒤 회복 시계 (LastStaminaUpdateAt). 없으면 가득 참 → 시계를 지운다
  nextAt?: number; // 다음 1 이 차는 때 (ms)
}

// 지금 스태미나(회복분 포함)에서 cost 를 뺀 값과 새 회복 시계.
//   가득 찬 상태에서 쓰면 지금부터 회복 시계가 돈다. 가득 차지 않았으면 원래 시계(쌓이던 회복)를 그대로 둔다.
//   최대보다 많이 저장돼 있으면(예전 보상 등) 깎아 버리지 않고 그 값에서 뺀다 (교실 판 Stamina - :cost 와 같음).
export function planStamina(stored: number, lastUpdateAt: number | undefined, nowMs: number, cost = BATTLE_STAMINA_COST): StaminaPlan {
  const eff = stored >= MAX_STAMINA ? { stamina: stored, clock: undefined } : effectiveStamina(stored, lastUpdateAt, nowMs);
  const before = eff.stamina;
  if (before < cost) {
    const clock = eff.clock;
    return { ok: false, before, after: before, clock, nextAt: clock !== undefined ? clock + REGEN_INTERVAL_MS : undefined };
  }
  const after = before - cost;
  if (after >= MAX_STAMINA) return { ok: true, before, after };
  const clock = before >= MAX_STAMINA || eff.clock === undefined ? nowMs : eff.clock;
  return { ok: true, before, after, clock, nextAt: clock + REGEN_INTERVAL_MS };
}

// PlayerResources.BattleSession — 판 하나. 끝(S7b)에서 BattleId · Status 를 보고 한 번만 마감한다
export interface BattleSession {
  BattleId: string;
  RequestId: string;
  QuizID: string;
  Difficulty: Difficulty;
  CharacterId?: string;
  StartedAt: string;
  StartedAtMs: number;
  Status: 'Active' | 'Finished';
  Cost: number;
}

export { MAX_STAMINA, REGEN_INTERVAL_MS };
