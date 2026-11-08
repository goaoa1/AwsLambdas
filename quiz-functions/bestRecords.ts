// ========================================
// bestRecords.ts - 단(QuizID)별 최고 기록 (친구 기능 3단계)
//   PlayerProfiles.BestRecords = { "<QuizID>": { Score, Time, Plays, At } }
//     Score: 가장 높은 점수, Time: 그 점수일 때 가장 짧은 시간(초), Plays: 끝낸 판 수, At: 기록을 세운 때
//   QuizID 1~9 = 11×11 ~ 19×19 (메뉴 버튼 OpenQuizMap "1"~"9"). 0 은 예전 기본 퀴즈.
//   QuizResults 에 결과가 들어올 때마다 updateBestRecords(스트림)가 갱신한다.
// ========================================

export interface BestRecord {
  Score: number;
  Time: number;
  Plays: number;
  At: string;
}

export type BestRecords = Record<string, BestRecord>;

export interface QuizResultLike {
  QuizID?: string | number;
  Score?: number;
  ElapsedTime?: number;
  CreatedAt?: string;
  QuestionCount?: number;
  CurrentQuestionIndex?: number;
}

// 끝까지 푼 결과만 기록으로 친다 (중간에 그만둔 세션은 결과로 저장되지 않지만 방어)
export function isCompleted(r: QuizResultLike): boolean {
  if (r.QuizID === undefined || r.QuizID === null || r.QuizID === '') return false;
  if (typeof r.Score !== 'number') return false;
  if (typeof r.QuestionCount === 'number' && typeof r.CurrentQuestionIndex === 'number') {
    return r.CurrentQuestionIndex >= r.QuestionCount;
  }
  return true;
}

export function better(a: { Score: number; Time: number }, b: { Score: number; Time: number } | undefined): boolean {
  if (!b) return true;
  if (a.Score !== b.Score) return a.Score > b.Score;
  return a.Time < b.Time;
}

// 결과 하나를 기록에 합친다 (Plays 는 늘 1 증가)
export function mergeResult(records: BestRecords, r: QuizResultLike): BestRecords {
  const id = String(r.QuizID);
  const prev = records[id];
  const cand = { Score: Number(r.Score ?? 0), Time: Math.round(Number(r.ElapsedTime ?? 0) * 10) / 10 };
  const plays = (prev?.Plays ?? 0) + 1;
  const next = { ...records };
  next[id] = better(cand, prev)
    ? { Score: cand.Score, Time: cand.Time, Plays: plays, At: r.CreatedAt ?? new Date().toISOString() }
    : { ...prev!, Plays: plays };
  return next;
}
