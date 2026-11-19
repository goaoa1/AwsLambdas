// ========================================
// deploy-repeat.mjs - 쉬움 · 보통 18문제 (문제마다 두 번, difficulty.ts REPEAT · repeatQuestions) 를 넣은 StartQuizSession 만 올리기 (2026-11-19)
//   node deploy-repeat.mjs [--dry]
//   1. esbuild 로 startQuizSession.ts → dist-repeat/startQuizSession.zip (deploy-difficulty.mjs 와 같은 설정)
//   2. StartQuizSession 코드 갱신 (역할 · 경로 · 테이블 그대로 — 세션의 QuestionIDs 가 18개가 될 뿐, 채점은 번호로 가서 그대로)
//   3. 기기 검사 다시 끼우기 (wrap-device-guard.mjs --only StartQuizSession): 코드를 새로 올리면 빠지기 때문
//   이미 시작한 판은 그대로(9문제), 새로 시작하는 쉬움 · 보통 판부터 18문제. 옛 기기도 서버가 정하므로 같이 18문제.
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROFILE = 'inchul';
const REGION = 'ap-northeast-2';
const DRY = process.argv.includes('--dry');
const outRoot = 'dist-repeat';
const name = 'startQuizSession';
const fn = 'StartQuizSession';

rmSync(outRoot, { recursive: true, force: true });
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

function aws(args, { json = true } = {}) {
  const cmd = `aws ${args} --profile ${PROFILE} --region ${REGION}${json ? ' --output json' : ''}`;
  console.log(`$ ${cmd}`);
  if (DRY) return null;
  const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return json && out.trim() ? JSON.parse(out) : out;
}
const zip = 'fileb://' + resolve(outRoot, `${name}.zip`).replace(/\\/g, '/');
const r = aws(`lambda update-function-code --function-name ${fn} --zip-file ${zip}`);
if (r) console.log('updated', r.FunctionName, r.LastModified, r.CodeSha256);
if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
if (!DRY) execSync(`node wrap-device-guard.mjs --only ${fn}`, { stdio: 'inherit' });
console.log(DRY ? 'dry run done' : '완료 — StartQuizSession 쉬움 · 보통 18문제 배포');
