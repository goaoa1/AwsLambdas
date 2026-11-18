// ========================================
// deploy-quizmilk.mjs - 판 끝 우유 배포 (2026-11-18, quizMilk.ts)
//   node deploy-quizmilk.mjs [--dry]
//   1. ProcessQuestionAnswer 역할에 PlayerResources UpdateItem · GetItem (QuizMilk ADD · 하루 상한 확인) — TT_QuizMilk (이미 있으면 같은 내용으로 덮음)
//   2. esbuild 로 processQuestionAnswer · getDuel · updateDuel → dist-quizmilk/<이름>.zip, 코드 갱신
//   3. 기기 검사 다시 끼우기 (wrap-device-guard.mjs --only ProcessQuestionAnswer,GetDuel,UpdateDuel)
//   옛 기기는 MilkGift · QuizMilk 를 읽지 않아 그대로 (우유는 서버에 쌓이고, 새 기기가 가방에서 보임).
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PROFILE = 'inchul';
const REGION = 'ap-northeast-2';
const DRY = process.argv.includes('--dry');
const outRoot = 'dist-quizmilk';
const FUNCTIONS = [
  { name: 'processQuestionAnswer', fn: 'ProcessQuestionAnswer', guard: true },
  { name: 'getDuel', fn: 'GetDuel', guard: true },
  { name: 'updateDuel', fn: 'UpdateDuel', guard: true },   // duelStore MilkGiven 상한 1000 → 1000000
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

// 1. 역할 권한: ProcessQuestionAnswer 가 PlayerResources.QuizMilk 를 ADD (건조 실행이면 AWS 를 부르지 않음)
if (DRY) {
  console.log('(dry) iam put-role-policy <ProcessQuestionAnswer 역할> TT_QuizMilk: dynamodb:UpdateItem + GetItem on PlayerResources');
} else {
  const out = execSync(`aws sts get-caller-identity --profile ${PROFILE} --region ${REGION} --output json`, { encoding: 'utf8' });
  const accountId = JSON.parse(out).Account;
  const roleArn = execSync(`aws lambda get-function-configuration --function-name ProcessQuestionAnswer --query Role --output text --profile ${PROFILE} --region ${REGION}`, { encoding: 'utf8' }).trim();
  const role = roleArn.split('/').pop();
  const dir = mkdtempSync(join(tmpdir(), 'quizmilk-'));
  const file = join(dir, 'policy.json');
  writeFileSync(file, JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: ['dynamodb:UpdateItem', 'dynamodb:GetItem'], Resource: [`arn:aws:dynamodb:${REGION}:${accountId}:table/PlayerResources`] }],
  }));
  aws(`iam put-role-policy --role-name ${role} --policy-name TT_QuizMilk --policy-document file://${file.replace(/\\/g, '/')}`, { json: false });
  console.log('IAM 전파 대기 8초');
  execSync('powershell -NoProfile -Command Start-Sleep 8');
}
for (const { name, fn } of FUNCTIONS) {
  const zip = 'fileb://' + resolve(outRoot, `${name}.zip`).replace(/\\/g, '/');
  const r = aws(`lambda update-function-code --function-name ${fn} --zip-file ${zip}`);
  if (r) console.log('updated', r.FunctionName, r.LastModified, r.CodeSha256);
  if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
}
const guarded = FUNCTIONS.filter((f) => f.guard).map((f) => f.fn).join(',');
if (!DRY) execSync(`node wrap-device-guard.mjs --only ${guarded}`, { stdio: 'inherit' });
console.log(DRY ? 'dry run done' : '완료 — 판 끝 우유 (ProcessQuestionAnswer · GetDuel · UpdateDuel)');
