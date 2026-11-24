// ========================================
// deploy-battle.mjs - 전투 판 입장(전투 개편 S7a) 배포 (aws cli, 프로필 inchul, ap-northeast-2) 2026-11-24
//   먼저:  node build-battle.mjs
//   실행:  node deploy-battle.mjs [--dry] [--only Fn1,Fn2]      (SSO 로그인 + 빌드 + 배포를 한 번에: deploy-battle.ps1)
//          --only: 그 함수만 (예: --only GetBattleRecords — 마도서 창의 전투 기록, deploy-battle-records.ps1)
//   1. 역할 TT_BattleLambdaRole (PlayerResources · PlayerQuestionStats 읽기/쓰기, PlayerDevices 읽기, 퀴즈 버킷의 문제표 읽기)
//   2. Lambda StartBattle (S7a) · FinishBattle (S7b — 판 끝: 다시 채점 · 정답률 · 전투 기록 · 우유)
//   3. REST: POST /start-battle · POST /finish-battle → stage_1 배포
//   4. 기기 검사 끼우기 (wrap-device-guard.mjs)
//   테이블은 새로 만들지 않는다 — 판은 PlayerResources.BattleSession 맵에 들어간다 (battleRules.ts).
// ========================================
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const PROFILE = 'inchul';
const REGION = 'ap-northeast-2';
const API_ID = '7sgqi34u0h';
const STAGE = 'stage_1';
const AUTHORIZER_ID = 'lu3670';
const AUTH_SCOPES = ['openid', 'aws.cognito.signin.user.admin'];
const TEMPLATE_FUNCTION = 'SelectCharacter';
const RUNTIME = 'nodejs22.x';
const ROLE_NAME = 'TT_BattleLambdaRole';
const DRY = process.argv.includes('--dry');

const ROUTES = [
  { zip: 'startBattle', fn: 'StartBattle', method: 'POST', path: 'start-battle' },
  { zip: 'finishBattle', fn: 'FinishBattle', method: 'POST', path: 'finish-battle' },
  // 마도서 창의 전투 기록 (2026-11-24): 판 끝이 적은 BattleRecords · BattleTotals 를 읽기만
  { zip: 'getBattleRecords', fn: 'GetBattleRecords', method: 'GET', path: 'get-battle-records' },
];
const onlyAt = process.argv.indexOf('--only');
const ONLY = onlyAt >= 0 ? (process.argv[onlyAt + 1] || '').split(',').filter(Boolean) : null;
const ACTIVE = ONLY ? ROUTES.filter((r) => ONLY.includes(r.fn)) : ROUTES;
if (ONLY && ACTIVE.length !== ONLY.length) throw new Error(`--only: 모르는 함수 ${ONLY.join(',')}`);

const tmp = mkdtempSync(join(tmpdir(), 'battle-deploy-'));
function aws(args, { json = true, allowFail = false, mutating = true } = {}) {
  const cmd = `aws ${args} --profile ${PROFILE} --region ${REGION}${json ? ' --output json' : ''}`;
  console.log(`$ ${cmd}`);
  if (DRY && mutating) return null;
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fileb(dir, zip) {
  const p = resolve(dir, `${zip}.zip`);
  if (!existsSync(p)) throw new Error(`${p} 가 없습니다. 먼저 build 스크립트를 실행하세요.`);
  return `fileb://${p.replace(/\\/g, '/')}`;
}
function jsonFile(name, obj) {
  const p = join(tmp, name);
  writeFileSync(p, JSON.stringify(obj));
  return `file://${p.replace(/\\/g, '/')}`;
}

const accountId = read(`sts get-caller-identity`).Account;
const template = read(`lambda get-function-configuration --function-name ${TEMPLATE_FUNCTION}`);
const layers = (template.Layers || []).map((l) => l.Arn);
const tableArn = (t) => `arn:aws:dynamodb:${REGION}:${accountId}:table/${t}`;
// 판 끝의 다시 채점(quiz-utils gradeUserAnswer)이 읽는 문제표 — 교실 판 StartQuizSession 과 같은 버킷
const quizBucket = (read(`lambda get-function-configuration --function-name StartQuizSession`).Environment?.Variables || {}).QUIZ_BUCKET_NAME;
if (!quizBucket) throw new Error('StartQuizSession 에 QUIZ_BUCKET_NAME 이 없음');

// 1. 역할
let roleArn = `arn:aws:iam::${accountId}:role/${ROLE_NAME}`;
const existingRole = read(`iam get-role --role-name ${ROLE_NAME}`, { allowFail: true });
let newRole = false;
if (!existingRole) {
  const trust = jsonFile('trust.json', {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
  });
  const created = aws(`iam create-role --role-name ${ROLE_NAME} --assume-role-policy-document ${trust} --description "TimesTable battle mode"`);
  if (created) roleArn = created.Role.Arn;
  aws(`iam attach-role-policy --role-name ${ROLE_NAME} --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`);
  newRole = true;
} else {
  roleArn = existingRole.Role.Arn;
}
aws(
  `iam put-role-policy --role-name ${ROLE_NAME} --policy-name TT_AccessBattleTables --policy-document ${jsonFile('policy.json', {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:UpdateItem'], Resource: [tableArn('PlayerResources'), tableArn('PlayerQuestionStats'), tableArn('PlayerStats')] },
      // 판 끝의 다시 채점: 문제표 (question/Question_0.json)
      { Effect: 'Allow', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${quizBucket}/question/*`, `arn:aws:s3:::${quizBucket}/quiz/*`] },
      // 기기 검사(deviceGuard)용
      { Effect: 'Allow', Action: ['dynamodb:GetItem'], Resource: [tableArn('PlayerDevices')] },
    ],
  })}`
);
if (newRole && !DRY) {
  console.log('IAM 전파 대기 12초');
  await sleep(12000);
}

// 2. Lambda
const envFile = jsonFile('env.json', { Variables: { REGION, QUIZ_BUCKET_NAME: quizBucket } });
for (const { zip, fn } of ACTIVE) {
  const exists = read(`lambda get-function-configuration --function-name ${fn}`, { allowFail: true });
  if (!exists) {
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      ok = DRY || !!aws(
        `lambda create-function --function-name ${fn} --runtime ${RUNTIME} --role ${roleArn} ` +
          `--handler index.handler --zip-file ${fileb('dist-battle', zip)} --timeout 15 --memory-size 256 ` +
          (layers.length ? `--layers ${layers.join(' ')} ` : '') +
          `--environment ${envFile}`,
        { allowFail: true }
      );
      if (!ok) { console.log('역할 전파 대기 후 다시 시도'); await sleep(6000); }
    }
    if (!ok) throw new Error(`create-function failed: ${fn}`);
    if (!DRY) aws(`lambda wait function-active-v2 --function-name ${fn}`, { json: false });
  } else {
    aws(`lambda update-function-code --function-name ${fn} --zip-file ${fileb('dist-battle', zip)}`);
    if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
  }
}

// 3. API
const resources = read(`apigateway get-resources --rest-api-id ${API_ID} --limit 500`).items;
const root = resources.find((r) => r.path === '/');
let changed = false;
for (const { fn, method, path } of ACTIVE) {
  let res = resources.find((r) => r.path === `/${path}`);
  if (!res) {
    res = aws(`apigateway create-resource --rest-api-id ${API_ID} --parent-id ${root.id} --path-part ${path}`) || { id: 'DRY', resourceMethods: {} };
    changed = true;
  }
  if (res.resourceMethods && res.resourceMethods[method]) continue;
  const fnArn = `arn:aws:lambda:${REGION}:${accountId}:function:${fn}`;
  aws(`apigateway put-method --rest-api-id ${API_ID} --resource-id ${res.id} --http-method ${method} --authorization-type COGNITO_USER_POOLS --authorizer-id ${AUTHORIZER_ID} --authorization-scopes ${AUTH_SCOPES.join(' ')}`);
  aws(`apigateway put-integration --rest-api-id ${API_ID} --resource-id ${res.id} --http-method ${method} --type AWS_PROXY --integration-http-method POST --uri arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${fnArn}/invocations`);
  aws(`apigateway put-method-response --rest-api-id ${API_ID} --resource-id ${res.id} --http-method ${method} --status-code 200 --response-models application/json=Empty`);
  aws(`apigateway put-integration-response --rest-api-id ${API_ID} --resource-id ${res.id} --http-method ${method} --status-code 200 --selection-pattern ""`, { allowFail: true });
  aws(
    `lambda add-permission --function-name ${fn} --statement-id apigw-${fn}-${method} --action lambda:InvokeFunction ` +
      `--principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:${REGION}:${accountId}:${API_ID}/*/${method}/${path}"`,
    { allowFail: true }
  );
  changed = true;
}
if (changed) aws(`apigateway create-deployment --rest-api-id ${API_ID} --stage-name ${STAGE} --description "battle ${new Date().toISOString()}"`);

// 4. 기기 검사
if (!DRY) execSync(`node wrap-device-guard.mjs --only ${ACTIVE.map((r) => r.fn).join(',')}`, { stdio: 'inherit' });
console.log('완료.');
