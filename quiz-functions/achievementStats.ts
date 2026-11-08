// ========================================
// achievementStats.ts - 도전과제 진행도 기록 (PlayerStats 테이블)
//   PlayerStats (PK PlayerID):
//     QuizzesCompleted, CorrectAnswers, PerfectQuizzes, LuckyHits, FocusMaxQuizzes, GiftsSent (N, 더하기)
//     ClearedQuizIds, CharactersPlayed (SS, 집합)
//     BestAvgSeconds (N, 작을수록 좋음), AttendanceStreakBest (N, 지금까지 가장 긴 연속 출석)
//     LastResultTs (N) - 마지막으로 반영한 QuizResults.Timestamp. 스트림이 같은 기록을 다시 보내도 두 번 세지 않게.
// ========================================
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

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
  BestAvgSeconds?: number;
  AttendanceStreakBest?: number;
  LastResultTs?: number;
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
