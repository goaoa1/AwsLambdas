// ========================================
// difficulty.ts - 난이도 모드 (2026-11-17)
//   사용자: "난이도 모드를 만든다. 쉬움 보통 어려움 매우 어려움 … 퀴즈 입장 전에 팝업을 통해 선택한다"
//   단(퀴즈 1~9 = 11~19단)은 그대로 두고, 그 단 안에서 문제 묶음만 난이도로 고른다.
//     → 세션 · 결과의 QuizID 는 1~9 그대로라 이야기(stageNN_cleared) · 단 정복 · 해금 · 현실 연결은 바뀌지 않음.
//   문제 묶음 ID = 기준 + 10 + 단 퀴즈 번호 (S3 quiz/Quiz_0.json, difficulty-quiz-data.mjs 가 만듦)
//     쉬움 211~219: 단 × 1~9 (9문제)
//     보통 311~319: 단 × 11~19 (9문제)
//     어려움 411~419: (단×2 · 단×3) × 11~19 (18문제) — 단×2·3 은 한 수로 보임 (18단 → 36, 54)
//     매우 어려움 511~519: (단×2 · 단×3) × (11~19 × 2~3 = 22~57) (34개 중 18문제 무작위, QuizSize)
//   시간 배율: 어려울수록 답 시간을 나눠 PERFECT(3초) · 느림(10초) · 피버 시간이 비슷한 느낌이 되게
//     (어려움 ×2, 매우 어려움 ×3 — 클라이언트 QuizDifficulty::TimeScale 과 같은 값)
// ========================================

export type Difficulty = 'easy' | 'normal' | 'hard' | 'veryhard';

export const DIFFICULTIES: Record<Difficulty, { base: number; timeScale: number }> = {
  easy: { base: 200, timeScale: 1 },
  normal: { base: 300, timeScale: 1 },
  hard: { base: 400, timeScale: 2 },
  veryhard: { base: 500, timeScale: 3 },
};

export function parseDifficulty(v: unknown): Difficulty | undefined {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(DIFFICULTIES, v) ? (v as Difficulty) : undefined;
}

// 단 퀴즈(1~9) + 난이도 → 문제 묶음 ID ("8" + hard → "418"). 단 퀴즈가 아니면(분수 111~119, 예전 0) 그대로
export function questionSetId(quizId: string, difficulty?: Difficulty): string {
  const n = Number(quizId);
  if (!difficulty || !Number.isInteger(n) || n < 1 || n > 9) return quizId;
  return String(DIFFICULTIES[difficulty].base + 10 + n);
}

// 답 시간 배율 (세션의 Difficulty — 없거나 모르면 1)
export function timeScale(difficulty?: unknown): number {
  const d = parseDifficulty(difficulty);
  return d ? DIFFICULTIES[d].timeScale : 1;
}
