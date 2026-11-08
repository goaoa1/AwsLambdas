// ========================================
// deploy-device.mjs - '한 계정 한 기기' 배포 (aws cli, 프로필 inchul, ap-northeast-2)
//   먼저:  node build-device.mjs
//   실행:  node deploy-device.mjs [--dry]
//   그다음: node wrap-device-guard.mjs   (기존 Lambda 앞에 기기 검사 끼우기)
//
//   1. DynamoDB PlayerDevices (PK PlayerID) - 계정마다 지금 쓰는 기기 번호 하나
//   2. IAM 역할 TT_DeviceLambdaRole (PlayerDevices 읽기/쓰기 + ActiveQuizSessions 읽기/쓰기: 예전 기기 퀴즈 일시정지)
//   3. Lambda ClaimDevice / CheckDevice
//   4. REST API: POST /claim-device, GET /check-device (Cognito 인가자) → stage_1 배포
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
const ROLE_NAME = 'TT_DeviceLambdaRole';
const DEVICE_TABLE = 'PlayerDevices';
const DRY = process.argv.includes('--dry');

const ROUTES = [
  { zip: 'claimDevice', fn: 'ClaimDevice', method: 'POST', path: 'claim-device' },
  { zip: 'checkDevice', fn: 'CheckDevice', method: 'GET', path: 'check-device' },
];

const tmp = mkdtempSync(join(tmpdir(), 'device-deploy-'));

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
  const p = resolve('dist-device', `${zip}.zip`);
  if (!existsSync(p)) throw new Error(`${p} 가 없습니다. 먼저 node build-device.mjs 를 실행하세요.`);
  return `fileb://${p.replace(/\\/g, '/')}`;
}
function jsonFile(name, obj) {
  const p = join(tmp, name);
  writeFileSync(p, JSON.stringify(obj));
  return `file://${p.replace(/\\/g, '/')}`;
}

const accountId = read(`sts get-caller-identity --query Account`, { json: false }).trim().replace(/"/g, '');
const template = read(`lambda get-function-configuration --function-name ${TEMPLATE_FUNCTION}`);
const layers = (template.Layers || []).map((l) => l.Arn);
const tableArn = (t) => `arn:aws:dynamodb:${REGION}:${accountId}:table/${t}`;

// 1. 테이블
if (!read(`dynamodb describe-table --table-name ${DEVICE_TABLE}`, { allowFail: true })) {
  aws(
    `dynamodb create-table --table-name ${DEVICE_TABLE} ` +
      `--attribute-definitions AttributeName=PlayerID,AttributeType=S ` +
      `--key-schema AttributeName=PlayerID,KeyType=HASH --billing-mode PAY_PER_REQUEST`
  );
  if (!DRY) aws(`dynamodb wait table-exists --table-name ${DEVICE_TABLE}`, { json: false });
} else {
  console.log(`table exists: ${DEVICE_TABLE}`);
}

// 2. 역할
let roleArn = `arn:aws:iam::${accountId}:role/${ROLE_NAME}`;
const existingRole = read(`iam get-role --role-name ${ROLE_NAME}`, { allowFail: true });
let newRole = false;
if (!existingRole) {
  const trust = jsonFile('trust.json', {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
  });
  const created = aws(`iam create-role --role-name ${ROLE_NAME} --assume-role-policy-document ${trust} --description "TimesTable single-device Lambdas"`);
  if (created) roleArn = created.Role.Arn;
  aws(`iam attach-role-policy --role-name ${ROLE_NAME} --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`);
  newRole = true;
} else {
  roleArn = existingRole.Role.Arn;
}
aws(
  `iam put-role-policy --role-name ${ROLE_NAME} --policy-name TT_AccessPlayerDevices --policy-document ${jsonFile('policy.json', {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:PutItem'], Resource: [tableArn(DEVICE_TABLE), tableArn('ActiveQuizSessions')] },
    ],
  })}`
);
if (newRole && !DRY) {
  console.log('IAM 전파 대기 12초');
  await sleep(12000);
}

// 3. Lambda
const envFile = jsonFile('env.json', { Variables: { REGION } });
for (const { zip, fn } of ROUTES) {
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
      if (!ok) { console.log('역할 전파 대기 후 다시 시도'); await sleep(6000); }
    }
    if (!ok) throw new Error(`create-function failed: ${fn}`);
    if (!DRY) aws(`lambda wait function-active-v2 --function-name ${fn}`, { json: false });
  } else {
    aws(`lambda update-function-code --function-name ${fn} --zip-file ${fileb(zip)}`);
    if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
  }
}

// 4. API
const resources = read(`apigateway get-resources --rest-api-id ${API_ID} --limit 500`).items;
const root = resources.find((r) => r.path === '/');
let changed = false;
for (const { fn, method, path } of ROUTES) {
  let res = resources.find((r) => r.path === `/${path}`);
  if (!res) {
    res = aws(`apigateway create-resource --rest-api-id ${API_ID} --parent-id ${root.id} --path-part ${path}`) || { id: 'DRY', resourceMethods: {} };
    changed = true;
  }
  if (res.resourceMethods && res.resourceMethods[method]) {
    console.log(`method exists: ${method} /${path}`);
    continue;
  }
  const fnArn = `arn:aws:lambda:${REGION}:${accountId}:function:${fn}`;
  aws(
    `apigateway put-method --rest-api-id ${API_ID} --resource-id ${res.id} --http-method ${method} ` +
      `--authorization-type COGNITO_USER_POOLS --authorizer-id ${AUTHORIZER_ID} --authorization-scopes ${AUTH_SCOPES.join(' ')}`
  );
  aws(
    `apigateway put-integration --rest-api-id ${API_ID} --resource-id ${res.id} --http-method ${method} ` +
      `--type AWS_PROXY --integration-http-method POST ` +
      `--uri arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${fnArn}/invocations`
  );
  aws(`apigateway put-method-response --rest-api-id ${API_ID} --resource-id ${res.id} --http-method ${method} --status-code 200 --response-models application/json=Empty`);
  aws(`apigateway put-integration-response --rest-api-id ${API_ID} --resource-id ${res.id} --http-method ${method} --status-code 200 --selection-pattern ""`, { allowFail: true });
  aws(
    `lambda add-permission --function-name ${fn} --statement-id apigw-${fn}-${method} --action lambda:InvokeFunction ` +
      `--principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:${REGION}:${accountId}:${API_ID}/*/${method}/${path}"`,
    { allowFail: true }
  );
  changed = true;
}
if (changed) {
  aws(`apigateway create-deployment --rest-api-id ${API_ID} --stage-name ${STAGE} --description "device ${new Date().toISOString()}"`);
}
console.log('완료. 다음: node wrap-device-guard.mjs');
