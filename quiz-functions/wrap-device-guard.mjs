// ========================================
// wrap-device-guard.mjs - 이미 배포된 Lambda 앞에 기기 검사(dist-device/guard-*/index.mjs)를 끼운다
//   node wrap-device-guard.mjs [--dry] [--only Fn1,Fn2] [--unwrap]
//
//   대상: QuizInGameAPI(7sgqi34u0h) 경로에 연결된 모든 Lambda (ClaimDevice 제외, CheckDevice 는 이미 검사함)
//   하는 일 (함수마다):
//     1. 배포된 zip 을 받아 dist-device/originals/<함수>.zip 에 처음 한 번 보관 (되돌리기용)
//     2. index.mjs / index.js → inner.mjs / inner.js 로 이름 바꾸고, 검사용 index.mjs 를 넣는다
//        (이미 끼워진 함수면 검사 코드만 새것으로 바꾼다)
//     3. 함수 역할에 PlayerDevices GetItem 권한(TT_ReadPlayerDevices) 추가
//     4. update-function-code
//   --unwrap: inner 를 다시 index 로 돌려놓는다
//
//   주의: build-shop / build-friends / npm build:zip 으로 함수를 다시 올리면 검사가 빠진다.
//         다시 올린 뒤에는 이 스크립트를 한 번 더 돌린다 (끼워진 함수는 건너뛰지 않고 새로 끼운다).
// ========================================
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const PROFILE = 'inchul';
const REGION = 'ap-northeast-2';
const API_ID = '7sgqi34u0h';
const DEVICE_TABLE = 'PlayerDevices';
const SKIP = new Set(['ClaimDevice', 'CheckDevice']);
const TAR = 'C:/Windows/System32/tar.exe';
const DRY = process.argv.includes('--dry');
const UNWRAP = process.argv.includes('--unwrap');
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;

function aws(args, { json = true, allowFail = false, mutating = true } = {}) {
  const cmd = `aws ${args} --profile ${PROFILE} --region ${REGION}${json ? ' --output json' : ''}`;
  if (DRY && mutating) { console.log(`(dry) $ ${cmd}`); return null; }
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return json && out.trim() ? JSON.parse(out) : out;
  } catch (e) {
    if (allowFail) return null;
    console.error(e.stderr || e.message);
    throw e;
  }
}
const read = (args, opt = {}) => aws(args, { ...opt, mutating: false });

const guardDir = resolve('dist-device');
if (!existsSync(join(guardDir, 'guard-mjs', 'index.mjs'))) throw new Error('먼저 node build-device.mjs');
const originals = join(guardDir, 'originals');
mkdirSync(originals, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'device-wrap-'));

const accountId = read(`sts get-caller-identity --query Account`, { json: false }).trim().replace(/"/g, '');
const policyFile = join(work, 'policy.json');
writeFileSync(policyFile, JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Action: ['dynamodb:GetItem'], Resource: [`arn:aws:dynamodb:${REGION}:${accountId}:table/${DEVICE_TABLE}`] }],
}));

// API 에 연결된 함수 이름 모으기
const resources = read(`apigateway get-resources --rest-api-id ${API_ID} --limit 500 --embed methods`).items;
const fns = new Set();
for (const r of resources) {
  for (const m of Object.values(r.resourceMethods ?? {})) {
    const uri = m.methodIntegration?.uri ?? '';
    const match = uri.match(/function:([^/:]+)\/invocations/);
    if (match && !SKIP.has(match[1])) fns.add(match[1]);
  }
}
const targets = [...fns].filter((f) => !ONLY || ONLY.has(f)).sort();
console.log(`대상 ${targets.length}개: ${targets.join(', ')}`);

const doneRoles = new Set();
const report = [];
for (const fn of targets) {
  const info = read(`lambda get-function --function-name ${fn}`);
  const { Handler, Role } = info.Configuration;
  if (Handler !== 'index.handler') { report.push(`${fn}: 건너뜀 (Handler=${Handler})`); continue; }

  const dir = join(work, fn);
  mkdirSync(dir, { recursive: true });
  const zipPath = join(work, `${fn}.zip`);
  // 받기 (S3 연결이 가끔 끊겨서 몇 번 다시 시도)
  let buf = null;
  for (let attempt = 1; attempt <= 4 && !buf; attempt++) {
    try {
      const res = await fetch(info.Code.Location, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      console.warn(`${fn}: 받기 실패 ${attempt}/4 (${e.cause?.code ?? e.message})`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  if (!buf) { report.push(`${fn}: 실패 (코드를 받지 못함)`); continue; }
  writeFileSync(zipPath, buf);
  execSync(`"${TAR}" -x -f "${zipPath}" -C "${dir}"`);
  const files = readdirSync(dir);
  const wrapped = files.includes('inner.mjs') || files.includes('inner.js');

  if (!wrapped && !existsSync(join(originals, `${fn}.zip`))) copyFileSync(zipPath, join(originals, `${fn}.zip`));

  let variant;
  if (UNWRAP) {
    if (!wrapped) { report.push(`${fn}: 끼워져 있지 않음`); continue; }
    rmSync(join(dir, 'index.mjs'));
    if (files.includes('inner.mjs')) renameSync(join(dir, 'inner.mjs'), join(dir, 'index.mjs'));
    else renameSync(join(dir, 'inner.js'), join(dir, 'index.js'));
  } else {
    if (wrapped) {
      variant = files.includes('inner.mjs') ? 'guard-mjs' : 'guard-js';
    } else if (files.includes('index.mjs')) {
      renameSync(join(dir, 'index.mjs'), join(dir, 'inner.mjs'));
      variant = 'guard-mjs';
    } else if (files.includes('index.js')) {
      renameSync(join(dir, 'index.js'), join(dir, 'inner.js'));
      variant = 'guard-js';
    } else {
      report.push(`${fn}: 건너뜀 (index 파일 없음: ${files.join(',')})`);
      continue;
    }
    copyFileSync(join(guardDir, variant, 'index.mjs'), join(dir, 'index.mjs'));
  }

  const outZip = join(work, `${fn}.out.zip`);
  const entries = readdirSync(dir).map((f) => `"${f}"`).join(' ');
  execSync(`"${TAR}" -a -c -f "${outZip}" -C "${dir}" ${entries}`);

  const roleName = Role.split('/').pop();
  if (!UNWRAP && !doneRoles.has(roleName)) {
    aws(`iam put-role-policy --role-name ${roleName} --policy-name TT_ReadPlayerDevices --policy-document file://${policyFile.replace(/\\/g, '/')}`);
    doneRoles.add(roleName);
  }
  aws(`lambda update-function-code --function-name ${fn} --zip-file fileb://${outZip.replace(/\\/g, '/')}`);
  if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
  report.push(`${fn}: ${UNWRAP ? '되돌림' : wrapped ? `검사 코드 갱신 (${variant})` : `끼움 (${variant})`} role=${roleName}`);
  console.log(report[report.length - 1]);
}
console.log('\n' + report.join('\n'));
