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
  FinishedAt?: string;
  Summary?: Record<string, unknown>;   // 끝낸 결과 (같은 끝을 다시 받으면 그대로 돌려준다)
}

// ========================================
// 판 끝 (finish-battle, 전투 개편 S7b, 2026-11-24 — 사용자: "이어서 쭉쭉 진행하자")
//   기기가 보낸 답을 서버가 다시 채점해 문제별 정답률에 더하고, 전투 기록(교실 기록과 따로)을 적고, 의뢰를 마치면 우유를 준다.
//   마물 · 결계 · 피해 셈은 기기가 하므로 서버는 '맞힌 수 · 걸린 시간으로 낼 수 있는 범위' 안인지만 본다 — 넘으면 Suspicious(기록은 남기되 최고 기록은 고치지 않음).
// ========================================
export const MAX_ANSWERS = 600;          // 한 판에 받는 답 (3분 + 보스 — 넉넉히)
export const MAX_POOL = 40;              // 마도서 칸 (한 권 · 난이도의 식 묶음)
export const LEARN_MIN_ANSWERS = 3;      // 외운 칸: 세 번 넘게 풀고
export const LEARN_RATE = 0.8;           //   80% 넘게 맞힘
export const DAMAGE_PER_CORRECT_CAP = 2000;   // 맞힌 한 발이 낼 수 있는 가장 큰 피해 (40 × 암송 2 × 공명 2 × 룬 · 스킬 · 모으기 — 넉넉히)
export const ALLY_DAMAGE_PER_SECOND = 60;     // 아군이 초마다 낼 수 있는 피해 (넉넉히)

export interface FinishAnswer {
  q: string; // 문제 번호 (교실 판과 같은 번호 — 정답률 표의 칸)
  a: string; // 친 답 (공명 중 한 자리 문제도 기기가 온전한 답으로 보낸다)
  ms: number;
}

export interface FinishStats {
  Damage: number;
  Kills: number;
  Recites: number;
  MaxChain: number;
  BestShot: number;
  Wrong: number;
  Releases: number;
  Level: number;
  Skills: number;
  BossDown: boolean;
  Dodged: number;
  Taken: number;
}

export interface FinishRequest {
  battleId: string;
  win: boolean;
  seconds: number;
  stats: FinishStats;
  answers: FinishAnswer[];
  pool: string[];
}

const num = (v: unknown, max = 1e9) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
};
const qid = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

export function parseFinishRequest(body: unknown): FinishRequest | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const battleId = typeof b.BattleId === 'string' ? b.BattleId : '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(battleId)) return 'Bad BattleId';
  const result = b.Result;
  if (result !== 'win' && result !== 'retreat') return 'Bad Result';
  const st = (b.Stats ?? {}) as Record<string, unknown>;
  const stats: FinishStats = {
    Damage: Math.round(num(st.Damage)),
    Kills: Math.round(num(st.Kills, 100000)),
    Recites: Math.round(num(st.Recites, 100000)),
    MaxChain: Math.round(num(st.MaxChain, 100000)),
    BestShot: Math.round(num(st.BestShot)),
    Wrong: Math.round(num(st.Wrong, 100000)),
    Releases: Math.round(num(st.Releases, 100000)),
    Level: Math.round(num(st.Level, 1000)),
    Skills: Math.round(num(st.Skills, 100000)),
    BossDown: st.BossDown === true,
    Dodged: Math.round(num(st.Dodged, 100000)),
    Taken: Math.round(num(st.Taken, 100000)),
  };
  const rawAnswers = Array.isArray(b.Answers) ? b.Answers : [];
  if (rawAnswers.length > MAX_ANSWERS) return 'Too many answers';
  const answers: FinishAnswer[] = [];
  for (const r of rawAnswers) {
    const o = (r ?? {}) as Record<string, unknown>;
    const q = qid(o.Q);
    if (!/^[0-9A-Za-z_]{1,24}$/.test(q)) continue;
    answers.push({ q, a: String(o.A ?? '').slice(0, 24), ms: Math.round(num(o.Ms, 600000)) });
  }
  const pool = (Array.isArray(b.Pool) ? b.Pool : []).map(qid).filter((q) => /^[0-9A-Za-z_]{1,24}$/.test(q)).slice(0, MAX_POOL);
  return { battleId, win: result === 'win', seconds: num(b.Seconds, 7200), stats, answers, pool };
}

// 맞힌 수 · 걸린 시간으로 낼 수 있는 범위를 넘는 것 (이유 목록 — 비면 괜찮음)
export function suspicious(req: FinishRequest, elapsedMs: number, corrects: number): string[] {
  const why: string[] = [];
  if (req.seconds * 1000 > elapsedMs + 15000) why.push('seconds>elapsed');
  if (req.answers.length > req.seconds * 3 + 10) why.push('answers>time');
  if (req.stats.Damage > corrects * DAMAGE_PER_CORRECT_CAP + req.seconds * ALLY_DAMAGE_PER_SECOND) why.push('damage>corrects');
  if (req.stats.Recites > corrects) why.push('recites>corrects');
  return why;
}

// 전투 기록 (PlayerResources.BattleRecords["<권>_<난이도>"]) — 교실 최고 기록과 따로
export interface BattleRecord {
  Plays: number;
  Wins: number;
  BestDamage: number;
  BestKills: number;
  BestChain: number;
  LastAt: string;
}

export interface NewBest {
  Damage: boolean;
  Kills: boolean;
  Chain: boolean;
}

export function updateRecord(prev: Partial<BattleRecord> | undefined, win: boolean, stats: FinishStats, trusted: boolean, now: string) {
  const p: BattleRecord = {
    Plays: num(prev?.Plays),
    Wins: num(prev?.Wins),
    BestDamage: num(prev?.BestDamage),
    BestKills: num(prev?.BestKills),
    BestChain: num(prev?.BestChain),
    LastAt: typeof prev?.LastAt === 'string' ? prev.LastAt : '',
  };
  const newBest: NewBest = {
    Damage: trusted && stats.Damage > p.BestDamage,
    Kills: trusted && stats.Kills > p.BestKills,
    Chain: trusted && stats.MaxChain > p.BestChain,
  };
  const record: BattleRecord = {
    Plays: p.Plays + 1,
    Wins: p.Wins + (win ? 1 : 0),
    BestDamage: newBest.Damage ? stats.Damage : p.BestDamage,
    BestKills: newBest.Kills ? stats.Kills : p.BestKills,
    BestChain: newBest.Chain ? stats.MaxChain : p.BestChain,
    LastAt: now,
  };
  return { record, newBest };
}

// 마도서 칸 (목업 ⑦ "마도서 13권 아홉 칸 중 일곱 칸 · 새로 외운 식"): 이 판의 묶음(pool)마다 정답률 표에서 외웠는지
//   after = 이번 판을 더한 뒤의 표, added = 이번 판에서 더한 수 — '새로 외운 식' = 이번 판으로 문턱을 넘은 칸
export interface GrimoireCell {
  Q: string;
  A: number;
  C: number;
  Learned: boolean;
  New: boolean;
}

const learned = (a: number, c: number) => a >= LEARN_MIN_ANSWERS && c / Math.max(a, 1) >= LEARN_RATE;

export function grimoire(pool: string[], after: Record<string, { A: number; C: number }>, added: Record<string, { A: number; C: number }>) {
  const cells: GrimoireCell[] = pool.map((q) => {
    const now = after[q] ?? { A: 0, C: 0 };
    const plus = added[q] ?? { A: 0, C: 0 };
    const was = learned(now.A - plus.A, now.C - plus.C);
    const isNow = learned(now.A, now.C);
    return { Q: q, A: now.A, C: now.C, Learned: isNow, New: isNow && !was };
  });
  return { Cells: cells, Learned: cells.filter((c) => c.Learned).length, Total: cells.length };
}

export { MAX_STAMINA, REGEN_INTERVAL_MS };
