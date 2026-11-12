// ========================================
// achievementProgress.ts - 도전과제 진행도 계산과 목록 만들기 (get-achievements / claim-achievement 공용)
//   PlayerAchievements (PK PlayerID, SK AchievementId): ClaimedTiers (N, 받은 단계 수. 단계는 차례대로만 받는다)
// ========================================
import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ACHIEVEMENTS, TABLE_QUIZ_IDS, TITLES, tierLocked, tierReached, type Achievement, type StatKey } from './achievementCatalog';
import { readStats, setIfHigher } from './achievementStats';
import { masteredTables } from './reality';
import { ITEM_NAME } from './itemCatalog';
import { listRows, countStatus } from './friendStore';

export const ACHIEVEMENT_TABLE = 'PlayerAchievements';
export const PLAYER_TABLE = 'PlayerResources';
const client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });

export type StatValues = Record<StatKey, number>;

/** extra.mastered: 숙련한 단 번호 (현실 연결, reality.ts) — buildAchievementList 가 응답에 싣는다 */
export async function computeStats(playerId: string, extra?: { mastered?: number[] }): Promise<StatValues> {
  const [stats, player, friendRows] = await Promise.all([
    readStats(playerId),
    client.send(
      new GetItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: playerId }),
        ProjectionExpression: 'AttendanceStreak, TotalAttendanceDays',
      })
    ),
    listRows(playerId).catch(() => []),
  ]);
  const p = player.Item ? unmarshall(player.Item) : {};
  if (extra) extra.mastered = masteredTables(stats.MasteredQuizIds);
  const streakNow = Number(p.AttendanceStreak) || 0;
  const streakBest = Math.max(streakNow, Number(stats.AttendanceStreakBest) || 0);
  if (streakNow > (Number(stats.AttendanceStreakBest) || 0)) {
    await setIfHigher(playerId, 'AttendanceStreakBest', streakNow).catch((e) => console.error('[achievements] streak best', e));
  }
  return {
    QuizzesCompleted: Number(stats.QuizzesCompleted) || 0,
    ClearedQuizCount: stats.ClearedQuizIds ? [...stats.ClearedQuizIds].filter((id) => TABLE_QUIZ_IDS.has(String(id))).length : 0,
    CorrectAnswers: Number(stats.CorrectAnswers) || 0,
    PerfectQuizzes: Number(stats.PerfectQuizzes) || 0,
    BestAvgSeconds: Number(stats.BestAvgSeconds) || 0, // 0 = 아직 기록 없음
    AttendanceStreakBest: streakBest,
    TotalAttendanceDays: Number(p.TotalAttendanceDays) || 0,
    FriendCount: countStatus(friendRows, 'Friend'),
    GiftsSent: Number(stats.GiftsSent) || 0,
    CharactersPlayed: stats.CharactersPlayed ? stats.CharactersPlayed.size : 0,
    LuckyHits: Number(stats.LuckyHits) || 0,
    FocusMaxQuizzes: Number(stats.FocusMaxQuizzes) || 0,
  };
}

export async function readClaimed(playerId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let start: Record<string, unknown> | undefined;
  do {
    const r = await client.send(
      new QueryCommand({
        TableName: ACHIEVEMENT_TABLE,
        KeyConditionExpression: 'PlayerID = :p',
        ExpressionAttributeValues: marshall({ ':p': playerId }),
        ExclusiveStartKey: start as never,
      })
    );
    for (const it of r.Items ?? []) {
      const row = unmarshall(it);
      out.set(row.AchievementId, Number(row.ClaimedTiers) || 0);
    }
    start = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (start);
  return out;
}

/** 다음에 받을 수 있는 단계 번호 (없으면 -1) */
export function nextClaimableTier(a: Achievement, progress: number, claimed: number): number {
  if (claimed >= a.Tiers.length) return -1;
  const tier = a.Tiers[claimed];
  if (tierLocked(tier)) return -1;
  return tierReached(a, progress, tier) ? claimed : -1;
}

export function toClientAchievement(a: Achievement, progress: number, claimed: number) {
  const next = nextClaimableTier(a, progress, claimed);
  return {
    Id: a.Id,
    Category: a.Category,
    Name: a.Name,
    Progress: progress,
    LowerIsBetter: !!a.LowerIsBetter,
    ClaimedTiers: claimed,
    Claimable: next >= 0,
    Tiers: a.Tiers.map((t, i) => ({
      Goal: t.Goal,
      Desc: a.Desc.replace('{Goal}', String(t.Goal)),
      Credits: t.Reward.Credits ?? 0,
      Stamina: t.Reward.Stamina ?? 0,
      Title: t.Reward.Title ?? '',
      TitleName: t.Reward.Title ? TITLES[t.Reward.Title] ?? '' : '',
      Outfit: t.Reward.Outfit ?? '',
      Items: Object.entries(t.Reward.Items ?? {}).map(([ItemId, Count]) => ({ ItemId, Name: ITEM_NAME(ItemId), Count })),
      Locked: tierLocked(t),
      Reached: tierReached(a, progress, t),
      Claimed: i < claimed,
    })),
  };
}

export async function buildAchievementList(playerId: string) {
  const extra: { mastered?: number[] } = {};
  const [stats, claimed] = await Promise.all([computeStats(playerId, extra), readClaimed(playerId)]);
  const list = ACHIEVEMENTS.map((a) => toClientAchievement(a, stats[a.Stat], claimed.get(a.Id) ?? 0));
  const titles: string[] = [];
  for (const a of ACHIEVEMENTS) {
    const n = claimed.get(a.Id) ?? 0;
    a.Tiers.slice(0, n).forEach((t) => t.Reward.Title && titles.push(t.Reward.Title));
  }
  return {
    Achievements: list,
    ClaimableCount: list.filter((x) => x.Claimable).length,
    Titles: titles.map((id) => ({ Id: id, Name: TITLES[id] ?? id })),
    Stats: stats,
    Mastered: extra.mastered ?? [],
  };
}
