// ========================================
// backfill-best-records.mjs - 지금까지의 QuizResults 로 PlayerProfiles.BestRecords 를 한 번 채운다 (친구 3단계)
//   aws sso login --profile inchul 뒤:  node backfill-best-records.mjs [--dry]
//   새 결과는 UpdateBestRecords(스트림)가 이어서 반영한다. LastResultAt 에 반영한 마지막 Timestamp 를 남겨
//   스트림이 같은 결과를 두 번 세지 않게 한다. 여러 번 돌려도 같은 값이 된다.
// ========================================
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const A = '--profile inchul --region ap-northeast-2 --output json';
const DRY = process.argv.includes('--dry');
const tmp = mkdtempSync(join(tmpdir(), 'backfill-'));
const aws = (args) => JSON.parse(execSync(`aws ${args} ${A}`).toString('utf8') || '{}');
const ascii = (o) => JSON.stringify(o).replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const file = (name, o) => { const p = join(tmp, name); writeFileSync(p, ascii(o), 'ascii'); return `file://${p.replace(/\\/g, '/')}`; };

// bestRecords.ts 와 같은 규칙
const num = (v) => (v?.N !== undefined ? Number(v.N) : undefined);
const better = (a, b) => !b || (a.Score !== b.Score ? a.Score > b.Score : a.Time < b.Time);

const items = [];
let start;
do {
  const r = aws(`dynamodb scan --table-name QuizResults${start ? ` --starting-token ${start}` : ''}`);
  items.push(...(r.Items ?? []));
  start = r.NextToken;
} while (start);

const byPlayer = new Map();
for (const it of items) {
  const quiz = it.QuizID?.S ?? (it.QuizID?.N !== undefined ? String(it.QuizID.N) : undefined);
  const score = num(it.Score);
  if (quiz === undefined || score === undefined) continue;
  const qc = num(it.QuestionCount), idx = num(it.CurrentQuestionIndex);
  if (qc !== undefined && idx !== undefined && idx < qc) continue;
  const pid = it.PlayerID.S;
  const ts = num(it.Timestamp) ?? 0;
  const rec = byPlayer.get(pid) ?? { records: {}, last: 0 };
  const cand = { Score: score, Time: Math.round((num(it.ElapsedTime) ?? 0) * 10) / 10 };
  const prev = rec.records[quiz];
  const plays = (prev?.Plays ?? 0) + 1;
  rec.records[quiz] = better(cand, prev) ? { ...cand, Plays: plays, At: it.CreatedAt?.S ?? '' } : { ...prev, Plays: plays };
  rec.last = Math.max(rec.last, ts);
  byPlayer.set(pid, rec);
}

const toAttr = (records) => ({
  M: Object.fromEntries(
    Object.entries(records).map(([k, v]) => [k, { M: { Score: { N: String(v.Score) }, Time: { N: String(v.Time) }, Plays: { N: String(v.Plays) }, At: { S: v.At } } }])
  ),
});

for (const [pid, { records, last }] of byPlayer) {
  console.log(pid.slice(0, 8), JSON.stringify(Object.fromEntries(Object.entries(records).map(([k, v]) => [k, `${v.Score}/${v.Time}s x${v.Plays}`]))));
  if (DRY) continue;
  execSync(
    `aws dynamodb update-item --table-name PlayerProfiles --key ${file('k.json', { PlayerID: { S: pid } })} ` +
      `--update-expression "SET BestRecords = :r, LastResultAt = :t" --expression-attribute-values ${file('v.json', { ':r': toAttr(records), ':t': { N: String(last) } })} ${A}`
  );
}
console.log(`results ${items.length}, players ${byPlayer.size}${DRY ? ' (dry)' : ''}`);
