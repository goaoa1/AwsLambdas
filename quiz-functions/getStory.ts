// ========================================
// getStory.ts - GET /get-story
//   { Story: { "Char_001": {...}, ... }, Rewards: ["potion_reaction", "tie_reward"],
//     Server: { QuizzesCompleted, ClearedStages: [11,12,...], AttendanceStreak, TotalAttendanceDays,
//               Flags: ["first_quiz_done", "stage11_cleared", ..., "streak_broken"] } }
//   Server.Flags 는 서버 기록(PlayerStats, 출석)에서 계산한 조건 플래그. 클라이언트는 기기 저장과 합쳐 에피소드 조건을 본다.
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId } from './friendStore';
import { readStats } from './achievementStats';
import { readStoryRow } from './storyStore';
import { STORY_REWARDS } from './storyCatalog';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  try {
    const [stats, { Story, Row }] = await Promise.all([readStats(me), readStoryRow(me)]);
    const quizzes = Number(stats.QuizzesCompleted) || 0;
    const cleared = new Set<number>();
    for (const id of stats.ClearedQuizIds ? [...stats.ClearedQuizIds] : []) {
      const n = Number(id);
      if (n >= 1 && n <= 9) cleared.add(10 + n); // 퀴즈 ID 1~9 = 11~19단
    }
    const streak = Number(Row.AttendanceStreak) || 0;
    const total = Number(Row.TotalAttendanceDays) || 0;
    const flags: string[] = [];
    if (quizzes >= 1) flags.push('first_quiz_done');
    for (const s of [...cleared].sort((a, b) => a - b)) {
      flags.push(`stage${s}_played`, `stage${s}_cleared`);
    }
    flags.push(total > streak ? 'streak_broken' : 'streak_unbroken');
    console.log(`[GetStory] ${me} chars=${Object.keys(Story).length} quizzes=${quizzes} cleared=${[...cleared].join(',')}`);
    return createSuccessResponse({
      Story,
      Rewards: Object.keys(STORY_REWARDS), // 보상이 있는 해금 id — 클라이언트가 이것만 claim-story-unlock 한다
      Server: { QuizzesCompleted: quizzes, ClearedStages: [...cleared].sort((a, b) => a - b), AttendanceStreak: streak, TotalAttendanceDays: total, Flags: flags },
    });
  } catch (e) {
    console.error('[GetStory] error', e);
    return createErrorResponse(500, 'Story error', { Reason: 'ServerError' });
  }
};
