// ========================================
// fever.ts - 콤보 · 피버 타임 · PERFECT (2026-11-16, 사용자: "a를 진행해보자" — 역동감 아이디어 A)
//   숫자를 바꿀 때는 이 파일만 고친다. 게임 쪽 표시용 숫자는 ComboFeverWidget.h 의 FeverLength · GaugeMax 와 맞춘다.
//
//   - 정답마다 피버 게이지 +20 (PERFECT 면 +30). 오답이면 게이지 −50 (0 아래로는 안 감).
//   - 게이지가 100 이 되면 다음 문제부터 5문제 동안 피버: 정답 점수 ×2. 피버 중 오답이면 피버가 바로 끝남.
//     피버 중에는 게이지가 차지 않음(끝나면 0 부터).
//   - PERFECT: 문제가 나온 뒤 3초 안에 맞힘 (기기에서 잰 AnswerMs, 0.4초 아래는 믿지 않음) → 점수 ×1.2, 게이지 +30.
//   - 점수 = round(기본 × 스킬 배율 × PERFECT 1.2 × 피버 2). 오답은 0점.
//   - 요청에 Fever: true 를 보내는 새 기기만. 옛 기기(폰 빌드 25 까지)는 예전 점수 그대로.
//   - 느린 정답 (2026-11-16, 사용자: 콤보 시간 규칙 "Add a soft time rule"): 문제가 나온 뒤 10초가 넘은 정답은
//     콤보는 이어지지만 게이지 +0. 피버 중이면 그 답은 ×2 없이 피버가 끝남. 오답 규칙은 그대로.
//   - 피버 v2 (2026-11-17, 사용자: "피버게이지를 시간에 따라 점점 닳게하자. 피버 중에는 답 맞췄다고 피버 게이지가 줄어드는 스펙은 아웃.")
//     → 맨 아래 applyFeverV2. 요청에 Fever: 2 를 보내는 기기만(그 전 기기는 Fever: true → 위의 5문제 피버 그대로).
// ========================================

export const FEVER_GAUGE_MAX = 100;
export const GAUGE_CORRECT = 20;
export const GAUGE_PERFECT = 30;
export const GAUGE_WRONG = 50;
export const FEVER_LENGTH = 5;
export const FEVER_MULTIPLIER = 2;
export const PERFECT_MS = 3000;
export const PERFECT_MIN_MS = 400;
export const PERFECT_MULTIPLIER = 1.2;
export const SLOW_MS = 10000;

export interface FeverState {
  FeverGauge: number; // 0 ~ 100 (이번 답 전)
  FeverLeft: number;  // 남은 피버 문제 수 (이번 답 전)
}

export interface FeverOutcome {
  Perfect: boolean;      // 이번 답이 PERFECT
  Slow: boolean;         // 이번 답이 느린 정답 (10초 넘음) — 게이지 +0, 피버 중이면 피버 끝
  FeverActive: boolean;  // 이번 답이 피버 중에 채점됨 (×2)
  FeverStarted: boolean; // 이번 답으로 게이지가 차서 다음 문제부터 피버
  FeverEnded: boolean;   // 이번 답으로 피버가 끝남 (다 쓰거나 오답)
  FeverGauge: number;    // 이번 답 뒤 게이지
  FeverLeft: number;     // 이번 답 뒤 남은 피버 문제 수
  Score: number;         // 최종 점수 (정수)
  PerfectBonus: number;  // PERFECT 로 더 받은 점수
  FeverBonus: number;    // 피버로 더 받은 점수
}

export function isSlow(answerMs: number | undefined): boolean {
  return typeof answerMs === 'number' && Number.isFinite(answerMs) && answerMs > SLOW_MS;
}

export function isPerfect(answerMs: number | undefined): boolean {
  return typeof answerMs === 'number' && Number.isFinite(answerMs) && answerMs >= PERFECT_MIN_MS && answerMs <= PERFECT_MS;
}

/**
 * @param skillRaw   기본 × 스킬 배율 (반올림 전)
 * @param skillScore 스킬만 적용한 정수 점수 (characterSkills 의 Score)
 */
export function applyFever(
  isCorrect: boolean,
  skillRaw: number,
  skillScore: number,
  answerMs: number | undefined,
  state: FeverState
): FeverOutcome {
  let gauge = Math.min(FEVER_GAUGE_MAX, Math.max(0, Number(state.FeverGauge) || 0));
  let left = Math.max(0, Math.floor(Number(state.FeverLeft) || 0));
  const inFever = left > 0;

  if (!isCorrect) {
    return {
      Perfect: false, Slow: false, FeverActive: inFever, FeverStarted: false, FeverEnded: inFever,
      FeverGauge: inFever ? 0 : Math.max(0, gauge - GAUGE_WRONG), FeverLeft: 0,
      Score: 0, PerfectBonus: 0, FeverBonus: 0,
    };
  }

  // 느린 정답: 콤보는 이어지지만(스킬 연속 정답은 그대로) 게이지 +0, 피버 중이면 ×2 없이 피버가 끝남
  if (isSlow(answerMs)) {
    return {
      Perfect: false, Slow: true, FeverActive: false, FeverStarted: false, FeverEnded: inFever,
      FeverGauge: inFever ? 0 : gauge, FeverLeft: 0,
      Score: skillScore, PerfectBonus: 0, FeverBonus: 0,
    };
  }

  const perfect = isPerfect(answerMs);
  const afterPerfect = skillRaw * (perfect ? PERFECT_MULTIPLIER : 1);
  const afterFever = afterPerfect * (inFever ? FEVER_MULTIPLIER : 1);
  const score = Math.round(afterFever);
  const perfectBonus = Math.round(afterPerfect) - skillScore;
  const feverBonus = score - Math.round(afterPerfect);

  let started = false;
  let ended = false;
  if (inFever) {
    left -= 1;
    ended = left === 0;
    gauge = 0;
  } else {
    gauge += perfect ? GAUGE_PERFECT : GAUGE_CORRECT;
    if (gauge >= FEVER_GAUGE_MAX) {
      gauge = 0;
      left = FEVER_LENGTH;
      started = true;
    }
  }
  return {
    Perfect: perfect, Slow: false, FeverActive: inFever, FeverStarted: started, FeverEnded: ended,
    FeverGauge: gauge, FeverLeft: left, Score: score, PerfectBonus: perfectBonus, FeverBonus: feverBonus,
  };
}

// ========================================
// 피버 v2 — 시간 피버 (2026-11-17, 사용자: "피버게이지를 시간에 따라 점점 닳게하자. 피버 중에는 답 맞췄다고 피버 게이지가 줄어드는 스펙은 아웃.")
//   요청에 Fever: 2 를 보낼 때만. 게이지 모으기(+20 / PERFECT +30 / 오답 −50 / 느린 정답 +0)는 그대로.
//   - 게이지가 100 이 되면 피버 시간 FEVER_MS(15초)가 생김. 피버 시간은 문제를 푸는 동안만 닳음 —
//     답마다 그 답 시간(AnswerMs: 문제가 나온 뒤 답까지 기기에서 잰 ms, 멈춘 시간 뺌, 최소 0.4초)만큼 줄어듦.
//     문제 사이(채점 · 다음 문제 기다림)는 안 닳음. 게임은 같은 시계로 게이지를 줄여 보여 줌.
//   - 피버 중 정답은 ×2, 게이지(피버 시간)를 따로 쓰지 않음 — 예전 '정답 하나 = 5문제 중 하나' 는 없앰.
//   - 이번 답 시간이 남은 피버 시간보다 길면(문제를 푸는 사이 다 닳음) 그 답은 ×2 없이 피버가 끝남.
//   - 피버 중 오답이면 바로 끝(그대로). 느린 정답 10초 규칙은 피버 밖에서만(피버 안에서는 시간이 대신함).
//   - 결과 · 세션에 FeverMsLeft(남은 피버 ms). FeverLeft 는 옛 표시와 맞추려고 피버가 이어지면 1, 아니면 0.
// ========================================
export const FEVER_MS = 15000;
export const FEVER_MIN_TICK_MS = PERFECT_MIN_MS;

export interface FeverStateV2 {
  FeverGauge: number;   // 0 ~ 100 (이번 답 전)
  FeverMsLeft: number;  // 남은 피버 ms (이번 답 전, 0 = 피버 아님)
}

export interface FeverOutcomeV2 extends FeverOutcome {
  FeverMsLeft: number;  // 이번 답 뒤 남은 피버 ms
  GaugeDrained: number; // 이번 답 동안 피버 밖 게이지가 닳은 양 (닳기를 안 쓰면 0)
}

// 피버 밖 게이지도 시간에 따라 닳음 (2026-11-18, 사용자: "피버 상태가 아니더라도 피버 게이지 시간에 따라 줄어들게 한다.
//   줄어드는 속도는 피버 상태일 때보다는 천천히"). 피버 시간처럼 문제를 푸는 동안만(답 시간 AnswerMs, 최소 0.4초) 닳음 —
//   초당 2 (피버는 게이지 100 을 15초에 = 초당 6.7 → 약 30% 빠르기). 요청에 GaugeDrain: true 를 보내는 새 기기만(옛 기기 · 옛 서버는 그대로).
//   닳은 뒤에 이번 답을 셈: 정답 +20 / PERFECT +30, 오답 −50, 느린 정답 +0. 결과에 GaugeDrained(이번 답에서 닳은 양).
//   게임 쪽 같은 숫자: UComboFeverWidget::IdleDrainPerSec.
export const GAUGE_IDLE_DRAIN_PER_SEC = 2;

export interface FeverOptionsV2 {
  idleDrain?: boolean;  // 피버 밖 게이지 닳기 (요청 GaugeDrain: true)
}

export function idleDrainFor(answerMs: number | undefined): number {
  if (typeof answerMs !== 'number' || !Number.isFinite(answerMs)) return 0;
  return Math.round((Math.max(FEVER_MIN_TICK_MS, answerMs) / 1000) * GAUGE_IDLE_DRAIN_PER_SEC);
}

export function applyFeverV2(
  isCorrect: boolean,
  skillRaw: number,
  skillScore: number,
  answerMs: number | undefined,
  state: FeverStateV2,
  options: FeverOptionsV2 = {}
): FeverOutcomeV2 {
  let gauge = Math.min(FEVER_GAUGE_MAX, Math.max(0, Number(state.FeverGauge) || 0));
  const msLeft = Math.max(0, Math.floor(Number(state.FeverMsLeft) || 0));
  const inFever = msLeft > 0;
  // 이번 답이 쓴 피버 시간 (AnswerMs 가 없으면 피버를 다 씀)
  const used = typeof answerMs === 'number' && Number.isFinite(answerMs) ? Math.max(FEVER_MIN_TICK_MS, answerMs) : FEVER_MS;
  const inTime = inFever && used <= msLeft;
  // 피버 밖: 이 문제를 푸는 동안 게이지가 먼저 닳음
  let drained = 0;
  if (!inFever && options.idleDrain) {
    drained = Math.min(gauge, idleDrainFor(answerMs));
    gauge -= drained;
  }

  if (!isCorrect) {
    return {
      Perfect: false, Slow: false, FeverActive: inFever, FeverStarted: false, FeverEnded: inFever,
      FeverGauge: inFever ? 0 : Math.max(0, gauge - GAUGE_WRONG), FeverLeft: 0, FeverMsLeft: 0,
      Score: 0, PerfectBonus: 0, FeverBonus: 0, GaugeDrained: drained,
    };
  }

  if (inFever) {
    // 피버 중 정답: 시간 안이면 ×2 + 쓴 시간만큼 줄어듦, 시간을 넘겼으면 ×2 없이 끝
    const perfect = isPerfect(answerMs);
    const afterPerfect = skillRaw * (perfect ? PERFECT_MULTIPLIER : 1);
    const score = Math.round(afterPerfect * (inTime ? FEVER_MULTIPLIER : 1));
    const left = inTime ? msLeft - used : 0;
    const ended = left <= 0;
    return {
      Perfect: perfect, Slow: false, FeverActive: inTime, FeverStarted: false, FeverEnded: ended,
      FeverGauge: 0, FeverLeft: ended ? 0 : 1, FeverMsLeft: Math.max(0, left),
      Score: score, PerfectBonus: Math.round(afterPerfect) - skillScore, FeverBonus: score - Math.round(afterPerfect),
      GaugeDrained: 0,
    };
  }

  // 피버 밖: 느린 정답은 게이지 +0 (콤보는 이어짐)
  if (isSlow(answerMs)) {
    return {
      Perfect: false, Slow: true, FeverActive: false, FeverStarted: false, FeverEnded: false,
      FeverGauge: gauge, FeverLeft: 0, FeverMsLeft: 0,
      Score: skillScore, PerfectBonus: 0, FeverBonus: 0, GaugeDrained: drained,
    };
  }
  const perfect = isPerfect(answerMs);
  const score = Math.round(skillRaw * (perfect ? PERFECT_MULTIPLIER : 1));
  gauge += perfect ? GAUGE_PERFECT : GAUGE_CORRECT;
  let started = false;
  let ms = 0;
  if (gauge >= FEVER_GAUGE_MAX) {
    gauge = 0;
    ms = FEVER_MS;
    started = true;
  }
  return {
    Perfect: perfect, Slow: false, FeverActive: false, FeverStarted: started, FeverEnded: false,
    FeverGauge: gauge, FeverLeft: started ? 1 : 0, FeverMsLeft: ms,
    Score: score, PerfectBonus: score - skillScore, FeverBonus: 0, GaugeDrained: drained,
  };
}
