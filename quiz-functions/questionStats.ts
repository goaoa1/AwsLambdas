// ========================================
// questionStats.ts - 문제별 정답률 (커리어 "정답률" 탭, 2026-11-09)
//   테이블 PlayerQuestionStats: 플레이어마다 한 줄 { PlayerID, A_<문제ID>: 푼 횟수, C_<문제ID>: 맞힌 횟수, UpdatedAt }
//   ProcessQuestionAnswer 가 채점할 때마다 recordAnswer (틀린 뒤 다시 풀기도 한 번씩 센다 — 사용자 결정 "Every answer")
//   GetQuestionStats 가 readStats 로 { "<문제ID>": { A, C } } 를 돌려준다.
// ========================================
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

export const QUESTION_STATS_TABLE = 'PlayerQuestionStats';
const ddb = new DynamoDBClient({ region: process.env.REGION });

// 속성 이름에 쓸 수 있게 (문제 ID 는 숫자 문자열이지만 혹시 몰라)
const key = (questionId: string) => String(questionId).replace(/[^0-9A-Za-z_]/g, '_');

export async function recordAnswer(playerId: string, questionId: string, correct: boolean): Promise<void> {
  const q = key(questionId);
  await ddb.send(
    new UpdateItemCommand({
      TableName: QUESTION_STATS_TABLE,
      Key: { PlayerID: { S: playerId } },
      UpdateExpression: 'SET UpdatedAt = :now ADD #a :one, #c :c',
      ExpressionAttributeNames: { '#a': `A_${q}`, '#c': `C_${q}` },
      ExpressionAttributeValues: {
        ':one': { N: '1' },
        ':c': { N: correct ? '1' : '0' },
        ':now': { S: new Date().toISOString() },
      },
    })
  );
}

// 여러 문제를 한 번에 더한다 (예전 로그 되살리기용). counts: { "<문제ID>": { A, C } }
export async function addCounts(playerId: string, counts: Record<string, { A: number; C: number }>): Promise<void> {
  const ids = Object.keys(counts);
  for (let i = 0; i < ids.length; i += 40) {
    const names: Record<string, string> = {};
    const values: Record<string, { N: string } | { S: string }> = { ':now': { S: new Date().toISOString() } };
    const parts: string[] = [];
    ids.slice(i, i + 40).forEach((id, j) => {
      const q = key(id);
      names[`#a${j}`] = `A_${q}`;
      names[`#c${j}`] = `C_${q}`;
      values[`:a${j}`] = { N: String(counts[id].A) };
      values[`:c${j}`] = { N: String(counts[id].C) };
      parts.push(`#a${j} :a${j}`, `#c${j} :c${j}`);
    });
    await ddb.send(
      new UpdateItemCommand({
        TableName: QUESTION_STATS_TABLE,
        Key: { PlayerID: { S: playerId } },
        UpdateExpression: `SET UpdatedAt = :now ADD ${parts.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );
  }
}

export async function readStats(playerId: string): Promise<Record<string, { A: number; C: number }>> {
  const res = await ddb.send(
    new GetItemCommand({ TableName: QUESTION_STATS_TABLE, Key: { PlayerID: { S: playerId } }, ConsistentRead: true })
  );
  const out: Record<string, { A: number; C: number }> = {};
  for (const [name, value] of Object.entries(res.Item || {})) {
    const m = /^([AC])_(.+)$/.exec(name);
    if (!m || value.N === undefined) continue;
    const row = (out[m[2]] ??= { A: 0, C: 0 });
    row[m[1] as 'A' | 'C'] = Number(value.N);
  }
  return out;
}
