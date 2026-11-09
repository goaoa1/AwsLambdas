// ========================================
// backfill-question-stats.mjs - 예전 답을 CloudWatch 로그에서 되살려 PlayerQuestionStats 에 더한다 (2026-11-09, 한 번만)
//   ProcessQuestionAnswer 는 2026-11-08 부터 채점마다 "[ProcessQuestionAnswer] <PlayerID> q=<문제ID> correct=<true|false>" 를 남긴다.
//   deploy-question-stats.mjs 가 적은 시각(question-stats-deployed-at.txt) 전의 줄만 센다 (그 뒤는 새 코드가 이미 셈).
//   PlayerID 가 UUID 꼴이 아닌 것(zz-test-… 같은 시험용 가짜 사용자)은 뺀다.
//   node backfill-question-stats.mjs [--dry]
// ========================================
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PROFILE = 'inchul';
const REGION = 'ap-northeast-2';
const LOG_GROUP = '/aws/lambda/ProcessQuestionAnswer';
const TABLE = 'PlayerQuestionStats';
const DRY = process.argv.includes('--dry');
const tmp = mkdtempSync(join(tmpdir(), 'qstats-backfill-'));

function aws(args, json = true) {
  const cmd = `aws ${args} --profile ${PROFILE} --region ${REGION}${json ? ' --output json' : ''}`;
  return json ? JSON.parse(execSync(cmd, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })) : execSync(cmd, { encoding: 'utf8' });
}

import { existsSync } from 'node:fs';
// 배포 전 --dry 로 미리 볼 때는 지금까지
const endIso = existsSync('question-stats-deployed-at.txt')
  ? readFileSync('question-stats-deployed-at.txt', 'utf8').trim()
  : DRY ? new Date().toISOString() : (() => { throw new Error('먼저 deploy-question-stats.mjs'); })();
const end = Date.parse(endIso);
const start = Date.parse('2026-11-01T00:00:00Z');
const events = aws(`logs filter-log-events --log-group-name ${LOG_GROUP} --start-time ${start} --end-time ${end} --filter-pattern "\\"q=\\" \\"correct=\\""`).events || [];
const re = /\[ProcessQuestionAnswer\] (\S+) q=(\S+) correct=(true|false)/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const per = {};
let used = 0, skipped = 0;
for (const e of events) {
  const m = re.exec(e.message || '');
  if (!m) continue;
  if (!uuid.test(m[1])) { skipped++; continue; }
  const row = ((per[m[1]] ??= {})[m[2]] ??= { A: 0, C: 0 });
  row.A += 1;
  if (m[3] === 'true') row.C += 1;
  used++;
}
console.log(`log lines ${events.length}, used ${used}, skipped (test ids) ${skipped}, players ${Object.keys(per).length}, until ${endIso}`);
for (const [player, counts] of Object.entries(per)) {
  const ids = Object.keys(counts);
  const a = ids.reduce((s, q) => s + counts[q].A, 0), c = ids.reduce((s, q) => s + counts[q].C, 0);
  console.log(`  ${player}: ${ids.length} questions, ${c}/${a} correct`);
  if (DRY) continue;
  for (let i = 0; i < ids.length; i += 40) {
    const names = {}, values = { ':now': { S: new Date().toISOString() } }, parts = [];
    ids.slice(i, i + 40).forEach((q, j) => {
      names[`#a${j}`] = `A_${q}`; names[`#c${j}`] = `C_${q}`;
      values[`:a${j}`] = { N: String(counts[q].A) }; values[`:c${j}`] = { N: String(counts[q].C) };
      parts.push(`#a${j} :a${j}`, `#c${j} :c${j}`);
    });
    const f = (n, o) => { const p = join(tmp, n); writeFileSync(p, JSON.stringify(o)); return `file://${p.replace(/\\/g, '/')}`; };
    aws(
      `dynamodb update-item --table-name ${TABLE} --key ${f('key.json', { PlayerID: { S: player } })} ` +
        `--update-expression "SET UpdatedAt = :now ADD ${parts.join(', ')}" ` +
        `--expression-attribute-names ${f('names.json', names)} --expression-attribute-values ${f('values.json', values)}`,
      false
    );
  }
}
console.log(DRY ? 'dry run (nothing written)' : 'done');
