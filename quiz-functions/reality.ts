// ========================================
// reality.ts - 현실 연결 (2026-11-12): 단 숙련 판정
//   "그 단 퀴즈 한 판(19문제)을 틀린 것 없이, 문제당 평균 3초 이하"로 끝낸 단 = 숙련 → 번외 한 화가 열린다.
//   QuizResults 스트림(updateAchievementStats → addFinishedQuiz)이 PlayerStats.MasteredQuizIds(SS)에 쌓고,
//   GET /get-achievements 가 Mastered: [11, 16, …] 로 돌려준다. 계획: TimesTable/Docs/현실_연결_계획.md R6
// ========================================
import { TABLE_QUIZ_IDS } from './achievementCatalog';

export const MASTERY_AVG_SEC = 3.0;
export const MASTERY_MIN_QUESTIONS = 19;

export interface MasteryInput {
  QuizID?: string;
  QuestionCount?: number;
  ElapsedTime?: number;
  WrongCount?: number;
}

/** 이 한 판이 그 단의 숙련인가 (곱셈 단 퀴즈 1~9, 틀림 0, 19문제 이상, 평균 3초 이하) */
export function isMastery(q: MasteryInput): boolean {
  if (!q.QuizID || !TABLE_QUIZ_IDS.has(String(q.QuizID))) return false;
  if (q.WrongCount !== 0) return false;
  const n = Number(q.QuestionCount) || 0;
  const t = Number(q.ElapsedTime) || 0;
  if (n < MASTERY_MIN_QUESTIONS || t <= 0) return false;
  return t / n <= MASTERY_AVG_SEC;
}

/** PlayerStats.MasteredQuizIds(퀴즈 ID 1~9) → 단 번호(11~19), 작은 순 */
export function masteredTables(ids?: Set<string> | string[]): number[] {
  if (!ids) return [];
  return [...ids]
    .map(String)
    .filter((id) => TABLE_QUIZ_IDS.has(id))
    .map((id) => 10 + Number(id))
    .sort((a, b) => a - b);
}
