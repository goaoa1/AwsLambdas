// ========================================
// deploy-question-stats.mjs - 문제별 정답률 배포 (aws cli, 프로필 inchul, ap-northeast-2) — 2026-11-09
//   먼저:  node build-question-stats.mjs
//   실행:  node deploy-question-stats.mjs [--dry]
//   1. 테이블 PlayerQuestionStats (PlayerID 키, 요청당 과금)
//   2. 역할 TT_QuestionStatsLambdaRole (PlayerQuestionStats 읽기, PlayerDevices 읽기) — GetQuestionStats 용
//   3. ProcessQuestionAnswer 역할에 PlayerQuestionStats 쓰기 추가
//   4. Lambda GetQuestionStats + REST GET /get-question-stats → stage_1 배포
//   5. ProcessQuestionAnswer 코드 갱신
//   6. 기기 검사 끼우기 (위 2개)
//   7. 배포 시각을 question-stats-deployed-at.txt 에 (예전 로그 되살리기의 끝 시각)
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
const ROLE_NAME = 'TT_QuestionStatsLambdaRole';
const TABLE = 'PlayerQuestionStats';
const DRY = process.argv.includes('--dry');

const NEW_ROUTES = [{ zip: 'getQuestionStats', fn: 'GetQuestionStats', method: 'GET', path: 'get-question-stats' }];
const UPDATED = [{ zip: 'processQuestionAnswer', fn: 'ProcessQuestionAnswer' }];

const tmp = mkdtempSync(join(tmpdir(), 'qstats-deploy-'));
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
function fileb(zip) {
  const p = resolve('dist-question-stats', `${zip}.zip`);
  if (!existsSync(p)) throw new Error(`${p} 가 없습니다. 먼저 node build-question-stats.mjs 를 실행하세요.`);
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

// 1. 테이블
if (!read(`dynamodb describe-table --table-name ${TABLE}`, { allowFail: true })) {
  aws(`dynamodb create-table --table-name ${TABLE} --attribute-definitions AttributeName=PlayerID,AttributeType=S --key-schema AttributeName=PlayerID,KeyType=HASH --billing-mode PAY_PER_REQUEST`);
  if (!DRY) aws(`dynamodb wait table-exists --table-name ${TABLE}`, { json: false });
}

// 2. GetQuestionStats 역할
let roleArn = `arn:aws:iam::${accountId}:role/${ROLE_NAME}`;
const existingRole = read(`iam get-role --role-name ${ROLE_NAME}`, { allowFail: true });
let newRole = false;
if (!existingRole) {
  const trust = jsonFile('trust.json', {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
  });
  const created = aws(`iam create-role --role-name ${ROLE_NAME} --assume-role-policy-document ${trust} --description "TimesTable question stats"`);
  if (created) roleArn = created.Role.Arn;
  aws(`iam attach-role-policy --role-name ${ROLE_NAME} --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`);
  newRole = true;
} else {
  roleArn = existingRole.Role.Arn;
}
aws(
  `iam put-role-policy --role-name ${ROLE_NAME} --policy-name TT_ReadQuestionStats --policy-document ${jsonFile('policy.json', {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['dynamodb:GetItem'], Resource: [tableArn(TABLE)] },
      { Effect: 'Allow', Action: ['dynamodb:GetItem'], Resource: [tableArn('PlayerDevices')] },
    ],
  })}`
);

// 3. ProcessQuestionAnswer 역할에 쓰기
const pqaRole = read(`lambda get-function-configuration --function-name ProcessQuestionAnswer`).Role.split('/').pop();
aws(
  `iam put-role-policy --role-name ${pqaRole} --policy-name TT_WriteQuestionStats --policy-document ${jsonFile('policy2.json', {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: ['dynamodb:UpdateItem'], Resource: [tableArn(TABLE)] }],
  })}`
);
if (newRole && !DRY) {
  console.log('IAM 전파 대기 12초');
  await sleep(12000);
}

// 4. GetQuestionStats + API
const envFile = jsonFile('env.json', { Variables: { REGION } });
for (const { zip, fn } of NEW_ROUTES) {
  const exists = read(`lambda get-function-configuration --function-name ${fn}`, { allowFail: true });
  if (!exists) {
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      ok = DRY || !!aws(
        `lambda create-function --function-name ${fn} --runtime ${RUNTIME} --role ${roleArn} ` +
          `--handler index.handler --zip-file ${fileb(zip)} --timeout 10 --memory-size 256 ` +
          (layers.length ? `--layers ${layers.join(' ')} ` : '') +
          `--environment ${envFile}`,
        { allowFail: true }
      );
      if (!ok) { console.log('잠시 뒤 다시 시도'); await sleep(6000); }
    }
    if (!ok) throw new Error(`create-function failed: ${fn}`);
    if (!DRY) aws(`lambda wait function-active-v2 --function-name ${fn}`, { json: false });
  } else {
    aws(`lambda update-function-code --function-name ${fn} --zip-file ${fileb(zip)}`);
    if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
  }
}
const resources = read(`apigateway get-resources --rest-api-id ${API_ID} --limit 500`).items;
const root = resources.find((r) => r.path === '/');
let changed = false;
for (const { fn, method, path } of NEW_ROUTES) {
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
if (changed) aws(`apigateway create-deployment --rest-api-id ${API_ID} --stage-name ${STAGE} --description "question stats ${new Date().toISOString()}"`);

// 5. ProcessQuestionAnswer
const deployedAt = new Date().toISOString();
for (const { zip, fn } of UPDATED) {
  aws(`lambda update-function-code --function-name ${fn} --zip-file ${fileb(zip)}`);
  if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
}

// 6. 기기 검사
const all = [...NEW_ROUTES, ...UPDATED].map((r) => r.fn).join(',');
if (!DRY) execSync(`node wrap-device-guard.mjs --only ${all}`, { stdio: 'inherit' });

// 7. 되살리기 끝 시각 (이 시각 전 로그만 더한다 — 그 뒤 답은 새 코드가 이미 센다)
if (!DRY) writeFileSync('question-stats-deployed-at.txt', deployedAt);
console.log('완료, ProcessQuestionAnswer 갱신 시각', deployedAt);
