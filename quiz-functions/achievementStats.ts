// ========================================
// achievementStats.ts - 도전과제 진행도 기록 (PlayerStats 테이블)
//   PlayerStats (PK PlayerID):
//     QuizzesCompleted, CorrectAnswers, PerfectQuizzes, LuckyHits, FocusMaxQuizzes, GiftsSent (N, 더하기)
//     ClearedQuizIds, CharactersPlayed (SS, 집합)
//     BestAvgSeconds (N, 작을수록 좋음), AttendanceStreakBest (N, 지금까지 가장 긴 연속 출석)
//     LastResultTs (N) - 마지막으로 반영한 QuizResults.Timestamp. 스트림이 같은 기록을 다시 보내도 두 번 세지 않게.
//     MasteredQuizIds (SS) - 숙련한 단의 퀴즈 ID (현실 연결 2026-11-12, reality.ts: 틀림 0 + 평균 3초 이하)
//     BattleKills, BattleRecites, BossInterrupts, BattleDodges (N, 더하기) - 전투 판 (2026-11-24, finishBattle.ts → addFinishedBattle)
// ========================================
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { isMastery } from './reality';

export const STATS_TABLE = 'PlayerStats';
const client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });

export interface PlayerStats {
  PlayerID: string;
  QuizzesCompleted?: number;
  CorrectAnswers?: number;
  PerfectQuizzes?: number;
  LuckyHits?: number;
  FocusMaxQuizzes?: number;
  GiftsSent?: number;
  ClearedQuizIds?: Set<string>;
  CharactersPlayed?: Set<string>;
  MasteredQuizIds?: Set<string>;
  BestAvgSeconds?: number;
  AttendanceStreakBest?: number;
  LastResultTs?: number;
  BattleKills?: number;
  BattleRecites?: number;
  BossInterrupts?: number;
  BattleDodges?: number;
}

export async function readStats(playerId: string): Promise<PlayerStats> {
  const r = await client.send(new GetItemCommand({ TableName: STATS_TABLE, Key: marshall({ PlayerID: playerId }) }));
  return (r.Item ? unmarshall(r.Item) : { PlayerID: playerId }) as PlayerStats;
}

/** 끝난 퀴즈 한 판 (QuizResults 한 줄) */
export interface FinishedQuiz {
  PlayerID: string;
  Timestamp: number;
  QuizID?: string;
  QuestionCount?: number;
  ElapsedTime?: number;
  CharacterId?: string;
  WrongCount?: number;     // 2026-11-08 부터 기록 (없으면 완벽 여부 모름)
  LuckyHits?: number;
  FocusMaxHit?: boolean;
}

/** 퀴즈 한 판을 진행도에 더한다. 이미 반영한 기록(LastResultTs 이하)이면 false */
export async function addFinishedQuiz(q: FinishedQuiz): Promise<boolean> {
  const sets: string[] = ['LastResultTs = :ts'];
  const adds: string[] = ['QuizzesCompleted :one'];
  const values: Record<string, unknown> = { ':ts': q.Timestamp, ':one': 1 };
  const names: Record<string, string> = {};

  const count = Number(q.QuestionCount) || 0;
  if (count > 0) { adds.push('CorrectAnswers :correct'); values[':correct'] = count; }
  if (q.QuizID) { adds.push('ClearedQuizIds :quiz'); values[':quiz'] = new Set([String(q.QuizID)]); }
  if (q.CharacterId) { adds.push('CharactersPlayed :char'); values[':char'] = new Set([q.CharacterId]); }
  if (q.WrongCount === 0) adds.push('PerfectQuizzes :one');
  if (q.QuizID && isMastery(q)) adds.push('MasteredQuizIds :quiz');
  if (q.LuckyHits && q.LuckyHits > 0) { adds.push('LuckyHits :lucky'); values[':lucky'] = q.LuckyHits; }
  if (q.FocusMaxHit) adds.push('FocusMaxQuizzes :one');

  // 평균 시간은 아래에서 따로 (더 작을 때만)
  try {
    await client.send(
      new UpdateItemCommand({
        TableName: STATS_TABLE,
        Key: marshall({ PlayerID: q.PlayerID }),
        UpdateExpression: `SET ${sets.join(', ')} ADD ${adds.join(', ')}`,
        ConditionExpression: 'attribute_not_exists(LastResultTs) OR LastResultTs < :ts',
        ExpressionAttributeValues: marshall(values, { convertClassInstanceToMap: false }),
        ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
      })
    );
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }

  const avg = count > 0 && q.ElapsedTime && q.ElapsedTime > 0 ? Math.round((q.ElapsedTime / count) * 100) / 100 : undefined;
  if (avg != null) await setIfLower(q.PlayerID, 'BestAvgSeconds', avg);
  return true;
}

/** 끝난 전투 판 한 판 (2026-11-24 — 사용자: "기존 반영 + 전투 4종"). finishBattle.ts 가 판을 마감한 뒤 한 번만 부른다 */
export interface FinishedBattle {
  PlayerID: string;
  Win: boolean;         // 의뢰 완료 (후퇴면 false)
  QuizID: string;
  CharacterId?: string;
  Corrects: number;     // 서버가 다시 매긴 맞힌 수
  Wrong: number;        // 서버가 다시 매긴 틀린 수
  Kills: number;
  Recites: number;      // 암송 (식이 뜬 뒤 3초 안에 맞힘)
  Interrupts: number;   // 보스의 두루마리 읽기를 끊은 수
  Dodged: number;       // 큰 공격을 피한 수
}

/** PlayerStats 에 더할 것 (ADD 식 · 값, 없으면 null).
 *  기존 도전과제: 의뢰 완료 = 퀴즈 완주 · 단 정복 · 모두와 함께, 틀린 식 없이 의뢰 완료 = 완벽한 퀴즈, 맞힌 수 = 누적 정답(후퇴 판도).
 *  번개 손 · 행운 · 최고 집중 · 숙련(현실 연결)은 교실 판의 시간 · 스킬 기준이라 세지 않는다 */
export function battleStatUpdate(b: FinishedBattle): { adds: string[]; values: Record<string, unknown> } | null {
  const adds: string[] = [];
  const values: Record<string, unknown> = {};
  const add = (field: string, key: string, value: unknown) => {
    adds.push(`${field} ${key}`);
    values[key] = value;
  };
  if (b.Corrects > 0) add('CorrectAnswers', ':correct', b.Corrects);
  if (b.Kills > 0) add('BattleKills', ':kills', b.Kills);
  if (b.Recites > 0) add('BattleRecites', ':recites', b.Recites);
  if (b.Interrupts > 0) add('BossInterrupts', ':breaks', b.Interrupts);
  if (b.Dodged > 0) add('BattleDodges', ':dodged', b.Dodged);
  if (b.Win) {
    add('QuizzesCompleted', ':one', 1);
    if (b.QuizID) add('ClearedQuizIds', ':quiz', new Set([String(b.QuizID)]));
    if (b.CharacterId) add('CharactersPlayed', ':char', new Set([b.CharacterId]));
    if (b.Wrong === 0 && b.Corrects > 0) adds.push('PerfectQuizzes :one');
  }
  return adds.length ? { adds, values } : null;
}

/** 전투 판 한 판을 진행도에 더한다 (더할 것이 없으면 false). 두 번 부르지 않는 것은 부르는 쪽(판 마감 조건)이 지킨다 */
export async function addFinishedBattle(b: FinishedBattle): Promise<boolean> {
  const u = battleStatUpdate(b);
  if (!u) return false;
  await client.send(
    new UpdateItemCommand({
      TableName: STATS_TABLE,
      Key: marshall({ PlayerID: b.PlayerID }),
      UpdateExpression: `ADD ${u.adds.join(', ')}`,
      ExpressionAttributeValues: marshall(u.values, { convertClassInstanceToMap: false }),
    })
  );
  return true;
}

export async function setIfLower(playerId: string, field: 'BestAvgSeconds', value: number) {
  try {
    await client.send(
      new UpdateItemCommand({
        TableName: STATS_TABLE,
        Key: marshall({ PlayerID: playerId }),
        UpdateExpression: 'SET #f = :v',
        ConditionExpression: 'attribute_not_exists(#f) OR #f > :v',
        ExpressionAttributeNames: { '#f': field },
        ExpressionAttributeValues: marshall({ ':v': value }),
      })
    );
  } catch (e) {
    if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e;
  }
}

export async function setIfHigher(playerId: string, field: 'AttendanceStreakBest', value: number) {
  try {
    await client.send(
      new UpdateItemCommand({
        TableName: STATS_TABLE,
        Key: marshall({ PlayerID: playerId }),
        UpdateExpression: 'SET #f = :v',
        ConditionExpression: 'attribute_not_exists(#f) OR #f < :v',
        ExpressionAttributeNames: { '#f': field },
        ExpressionAttributeValues: marshall({ ':v': value }),
      })
    );
  } catch (e) {
    if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e;
  }
}

export async function addCounter(playerId: string, field: 'GiftsSent', by = 1) {
  await client.send(
    new UpdateItemCommand({
      TableName: STATS_TABLE,
      Key: marshall({ PlayerID: playerId }),
      UpdateExpression: 'ADD #f :n',
      ExpressionAttributeNames: { '#f': field },
      ExpressionAttributeValues: marshall({ ':n': by }),
    })
  );
}
