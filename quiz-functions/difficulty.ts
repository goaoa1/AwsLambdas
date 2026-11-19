// ========================================
// difficulty.ts - 난이도 모드 (2026-11-17)
//   사용자: "난이도 모드를 만든다. 쉬움 보통 어려움 매우 어려움 … 퀴즈 입장 전에 팝업을 통해 선택한다"
//   단(퀴즈 1~9 = 11~19단)은 그대로 두고, 그 단 안에서 문제 묶음만 난이도로 고른다.
//     → 세션 · 결과의 QuizID 는 1~9 그대로라 이야기(stageNN_cleared) · 단 정복 · 해금 · 현실 연결은 바뀌지 않음.
//   문제 묶음 ID = 기준 + 10 + 단 퀴즈 번호 (S3 quiz/Quiz_0.json, difficulty-quiz-data.mjs 가 만듦)
//     쉬움 211~219: 단 × 1~9 (9문제 — 2026-11-19 부터 문제마다 두 번 = 18문제, REPEAT)
//     보통 311~319: 단 × 11~19 (9문제 — 2026-11-19 부터 문제마다 두 번 = 18문제, REPEAT)
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

// 문제를 몇 번씩 낼지 (2026-11-19, 사용자: "문제가 9개인 애들 문제 수를 18개로 늘리자. 중복하게 해서. 예를 들어 19*12가 두번 나오는 거.")
//   쉬움 · 보통(9문제 묶음)은 문제마다 두 번 → 18문제. 어려움 · 매우 어려움은 이미 18문제라 한 번씩.
//   채점(quiz-utils processQuizStep)은 번호(CurrentQuestionIndex) · 다시 풀 줄(RetryQuestionIDs)로만 가서 같은 ID 가 두 번 있어도 됨.
export const REPEAT: Record<Difficulty, number> = { easy: 2, normal: 2, hard: 1, veryhard: 1 };

export function repeatFor(difficulty?: Difficulty): number {
  return difficulty ? REPEAT[difficulty] : 1;
}

// 같은 문제가 다시 나올 때 사이에 적어도 이만큼 (4 = 그 사이에 다른 문제 3개 이상) — 방금 푼 문제가 곧바로 또 나오지 않게
export const REPEAT_MIN_GAP = 4;

// 같은 문제들을 Times 바퀴 — 첫 바퀴는 받은 순서(이미 섞임), 다음 바퀴부터는 새로 섞되
//   바퀴가 바뀌는 곳에서 같은 문제가 REPEAT_MIN_GAP 안에 다시 오지 않게 (여러 번 섞어 보고 가장 띄워진 것; 같은 식이 연달아 오면 문제 카드가 새로 안 뜸)
export function repeatQuestions(ids: string[], times: number, rand: () => number = Math.random): string[] {
  const out = ids.slice();
  if (times <= 1 || ids.length === 0) return out;
  const shuffled = () => {
    const pass = ids.slice();
    for (let i = pass.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pass[i], pass[j]] = [pass[j], pass[i]];
    }
    return pass;
  };
  // 이 바퀴를 붙였을 때 같은 문제끼리 가장 가까운 거리
  const minGap = (pass: string[]) => {
    let gap = Number.MAX_SAFE_INTEGER;
    pass.forEach((id, k) => {
      const last = out.lastIndexOf(id);
      if (last >= 0) gap = Math.min(gap, out.length + k - last);
    });
    return gap;
  };
  for (let t = 1; t < times; t++) {
    let best = shuffled();
    let bestGap = minGap(best);
    for (let tries = 0; tries < 200 && bestGap < REPEAT_MIN_GAP; tries++) {
      const p = shuffled();
      const g = minGap(p);
      if (g > bestGap) {
        best = p;
        bestGap = g;
      }
    }
    out.push(...best);
  }
  return out;
}
