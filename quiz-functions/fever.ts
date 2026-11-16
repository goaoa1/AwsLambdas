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

export interface FeverState {
  FeverGauge: number; // 0 ~ 100 (이번 답 전)
  FeverLeft: number;  // 남은 피버 문제 수 (이번 답 전)
}

export interface FeverOutcome {
  Perfect: boolean;      // 이번 답이 PERFECT
  FeverActive: boolean;  // 이번 답이 피버 중에 채점됨 (×2)
  FeverStarted: boolean; // 이번 답으로 게이지가 차서 다음 문제부터 피버
  FeverEnded: boolean;   // 이번 답으로 피버가 끝남 (다 쓰거나 오답)
  FeverGauge: number;    // 이번 답 뒤 게이지
  FeverLeft: number;     // 이번 답 뒤 남은 피버 문제 수
  Score: number;         // 최종 점수 (정수)
  PerfectBonus: number;  // PERFECT 로 더 받은 점수
  FeverBonus: number;    // 피버로 더 받은 점수
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
      Perfect: false, FeverActive: inFever, FeverStarted: false, FeverEnded: inFever,
      FeverGauge: inFever ? 0 : Math.max(0, gauge - GAUGE_WRONG), FeverLeft: 0,
      Score: 0, PerfectBonus: 0, FeverBonus: 0,
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
    Perfect: perfect, FeverActive: inFever, FeverStarted: started, FeverEnded: ended,
    FeverGauge: gauge, FeverLeft: left, Score: score, PerfectBonus: perfectBonus, FeverBonus: feverBonus,
  };
}
