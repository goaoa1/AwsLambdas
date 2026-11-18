// ========================================
// attendanceDays.ts - 출석 달력 (2026-11-18, 사용자: "매일 첫번째 로그인했을 때 달력 위젯에 출석 여부를 체크하게 하자")
//   출석한 날(KST "YYYY-MM-DD")을 PlayerResources.AttendanceDays (문자열 집합, SS)에 모은다 — claimDailyAttendance 가 ADD.
//   예전에는 날짜를 남기지 않았으므로 집합이 없으면 지금 이어 온 연속 출석(LastAttendanceDate 에서 AttendanceStreak 일 거꾸로)으로 채운다.
//   recordPlayerInfo · claimDailyAttendance 는 최근 70일만 돌려준다 (달력은 이번 달 · 지난 달 끝).
// ========================================

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function kstDate(offsetDays = 0, nowMs = Date.now()): string {
  return new Date(nowMs + 9 * 60 * 60 * 1000 + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

// 연속 출석으로 채우기: last 부터 streak 일 거꾸로 (last 포함)
export function streakDays(last: string | undefined, streak: number): string[] {
  if (!last || !DATE_RE.test(last) || !(streak > 0)) return [];
  const n = Math.min(Math.floor(streak), 400);
  return Array.from({ length: n }, (_, i) => addDays(last, -i));
}

// DynamoDB 에서 읽은 값(Set · 배열 · 없음) → 날짜 배열
export function toDayList(v: unknown): string[] | undefined {
  if (v instanceof Set) return [...v].map(String);
  if (Array.isArray(v)) return v.map(String);
  return undefined;
}

// 저장된 날짜 (없으면 연속 출석으로 채운 날짜)
export function knownDays(stored: unknown, last: string | undefined, streak: number): string[] {
  return toDayList(stored) ?? streakDays(last, streak);
}

// 최근 keep 일(오늘 포함)만, 중복 없이 오름차순
export function recentDays(days: Iterable<string>, today: string, keep = 70): string[] {
  const from = addDays(today, -keep);
  return [...new Set(days)].filter((d) => DATE_RE.test(d) && d >= from && d <= today).sort();
}
