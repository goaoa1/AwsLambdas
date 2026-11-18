// ========================================
// deploy-attendance.mjs - 출석 달력 배포 (2026-11-18, attendanceDays.ts)
//   node deploy-attendance.mjs [--dry]
//   1. esbuild 로 claimDailyAttendance · recordPlayerInfo → dist-attendance/<이름>.zip, 코드 갱신
//      (테이블 · 역할 그대로 — PlayerResources 에 AttendanceDays 문자열 집합이 늘어날 뿐, 응답에 AttendanceDays · TodayKST)
//   2. 기기 검사 다시 끼우기 (wrap-device-guard.mjs --only ClaimDailyAttendance,RecordPlayerInfo)
//   옛 기기는 새 필드를 읽지 않아 그대로.
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROFILE = 'inchul';
const REGION = 'ap-northeast-2';
const DRY = process.argv.includes('--dry');
const outRoot = 'dist-attendance';
const FUNCTIONS = [
  { name: 'claimDailyAttendance', fn: 'ClaimDailyAttendance', guard: true },
  { name: 'recordPlayerInfo', fn: 'RecordPlayerInfo', guard: true },
];

rmSync(outRoot, { recursive: true, force: true });
for (const { name } of FUNCTIONS) {
  const dir = join(outRoot, name);
  mkdirSync(dir, { recursive: true });
  await build({
    entryPoints: [`${name}.ts`],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: join(dir, 'index.mjs'),
    external: ['quiz-utils/*', '@aws-sdk/*', '@aws-lambda-powertools/*', '@middy/*'],
    logLevel: 'warning',
  });
  execSync(`C:/Windows/System32/tar.exe -a -c -f ${name}.zip -C ${name} index.mjs`, { cwd: outRoot, stdio: 'inherit' });
  console.log(`built ${outRoot}/${name}.zip`);
}

function aws(args, { json = true } = {}) {
  const cmd = `aws ${args} --profile ${PROFILE} --region ${REGION}${json ? ' --output json' : ''}`;
  console.log(`$ ${cmd}`);
  if (DRY) return null;
  const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return json && out.trim() ? JSON.parse(out) : out;
}

for (const { name, fn } of FUNCTIONS) {
  const zip = 'fileb://' + resolve(outRoot, `${name}.zip`).replace(/\\/g, '/');
  const r = aws(`lambda update-function-code --function-name ${fn} --zip-file ${zip}`);
  if (r) console.log('updated', r.FunctionName, r.LastModified, r.CodeSha256);
  if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
}
const guarded = FUNCTIONS.filter((f) => f.guard).map((f) => f.fn).join(',');
if (!DRY) execSync(`node wrap-device-guard.mjs --only ${guarded}`, { stdio: 'inherit' });
console.log(DRY ? 'dry run done' : '완료 — 출석 달력 (ClaimDailyAttendance · RecordPlayerInfo)');
