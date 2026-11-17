// ========================================
// deploy-difficulty.mjs - 난이도 모드 배포 (2026-11-17, difficulty.ts)
//   node deploy-difficulty.mjs [--dry] [--no-data]
//   1. S3 문제 · 문제 묶음 올리기: node difficulty-quiz-data.mjs push (먼저 pull · build 해 둔 difficulty-data/after) — --no-data 면 건너뜀
//      (데이터가 먼저: 새 StartQuizSession 은 묶음이 없으면 예전 단 퀴즈로 시작하지만, 묶음이 있어야 난이도가 적용됨)
//   2. esbuild 로 startQuizSession · processQuestionAnswer · updateBestRecords → dist-difficulty/<이름>.zip, 코드 갱신
//      (역할 · 경로 · 테이블은 그대로 — 세션 · 결과에 Difficulty · QuestionSetID 가 늘어날 뿐)
//   3. 기기 검사 다시 끼우기 (wrap-device-guard.mjs --only StartQuizSession,ProcessQuestionAnswer): 코드를 새로 올리면 빠지기 때문.
//      UpdateBestRecords 는 QuizResults 스트림이 부르는 함수라 기기 검사가 없음.
//   옛 기기는 Difficulty 를 안 보내 예전 19문제 그대로.
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROFILE = 'inchul';
const REGION = 'ap-northeast-2';
const DRY = process.argv.includes('--dry');
const NO_DATA = process.argv.includes('--no-data');
const outRoot = 'dist-difficulty';
const FUNCTIONS = [
  { name: 'startQuizSession', fn: 'StartQuizSession', guard: true },
  { name: 'processQuestionAnswer', fn: 'ProcessQuestionAnswer', guard: true },
  { name: 'updateBestRecords', fn: 'UpdateBestRecords', guard: false },
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

if (!NO_DATA) {
  console.log(DRY ? '(dry) node difficulty-quiz-data.mjs push' : '$ node difficulty-quiz-data.mjs push');
  if (!DRY) execSync('node difficulty-quiz-data.mjs push', { stdio: 'inherit' });
}
for (const { name, fn } of FUNCTIONS) {
  const zip = 'fileb://' + resolve(outRoot, `${name}.zip`).replace(/\\/g, '/');
  const r = aws(`lambda update-function-code --function-name ${fn} --zip-file ${zip}`);
  if (r) console.log('updated', r.FunctionName, r.LastModified, r.CodeSha256);
  if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
}
const guarded = FUNCTIONS.filter((f) => f.guard).map((f) => f.fn).join(',');
if (!DRY) execSync(`node wrap-device-guard.mjs --only ${guarded}`, { stdio: 'inherit' });
console.log(DRY ? 'dry run done' : '완료 — 난이도 모드 (문제 묶음 + StartQuizSession · ProcessQuestionAnswer · UpdateBestRecords)');
