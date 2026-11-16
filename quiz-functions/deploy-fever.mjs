// ========================================
// deploy-fever.mjs - 콤보 · 피버 · PERFECT (fever.ts) 를 넣은 ProcessQuestionAnswer 만 묶어서 올리기 (2026-11-16)
//   node deploy-fever.mjs [--dry]
//   1. esbuild 로 processQuestionAnswer.ts → dist-fever/processQuestionAnswer.zip (build-question-stats.mjs 와 같은 설정)
//   2. ProcessQuestionAnswer 코드 갱신 (역할 · 경로는 그대로 — 새 DynamoDB 테이블 없음, 세션 필드만 늘어남)
//   3. 기기 검사 다시 끼우기 (wrap-device-guard.mjs --only ProcessQuestionAnswer): 코드를 새로 올리면 검사가 빠지기 때문
//   옛 기기는 요청에 Fever 가 없어 점수가 예전 그대로.
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROFILE = 'inchul';
const REGION = 'ap-northeast-2';
const DRY = process.argv.includes('--dry');
const outRoot = 'dist-fever';
const name = 'processQuestionAnswer';
const fn = 'ProcessQuestionAnswer';

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
console.log(DRY ? 'dry run done' : '완료 — ProcessQuestionAnswer 피버 판 배포');
