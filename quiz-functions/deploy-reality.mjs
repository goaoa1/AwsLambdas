// ========================================
// deploy-reality.mjs - 현실 연결 배포 (2026-11-12): 매점 덤 POST /claim-shop-bonus
//   먼저:  node build-reality.mjs
//   실행:  node deploy-reality.mjs [--dry]
//   1. 역할은 스토리 것(TT_StoryLambdaRole: PlayerResources 읽기/쓰기, PlayerDevices 읽기)을 그대로
//   2. Lambda ClaimShopBonus (없으면 만들고, 있으면 코드만)
//   3. REST: POST /claim-shop-bonus (Cognito 인증) → stage_1 배포
//   4. 기기 검사 끼우기
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
const ROLE_NAME = 'TT_StoryLambdaRole';
const DRY = process.argv.includes('--dry');

const ROUTES = [
  { zip: 'claimShopBonus', fn: 'ClaimShopBonus', method: 'POST', path: 'claim-shop-bonus' },
];

const tmp = mkdtempSync(join(tmpdir(), 'story-deploy-'));
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

// 1. 역할
let roleArn = `arn:aws:iam::${accountId}:role/${ROLE_NAME}`;
const existingRole = read(`iam get-role --role-name ${ROLE_NAME}`, { allowFail: true });
let newRole = false;
if (!existingRole) {
  const trust = jsonFile('trust.json', {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
  });
  const created = aws(`iam create-role --role-name ${ROLE_NAME} --assume-role-policy-document ${trust} --description "TimesTable story progress"`);
  if (created) roleArn = created.Role.Arn;
  aws(`iam attach-role-policy --role-name ${ROLE_NAME} --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`);
  newRole = true;
} else {
  roleArn = existingRole.Role.Arn;
}
aws(
  `iam put-role-policy --role-name ${ROLE_NAME} --policy-name TT_AccessStoryTables --policy-document ${jsonFile('policy.json', {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:UpdateItem'], Resource: [tableArn('PlayerResources')] },
      { Effect: 'Allow', Action: ['dynamodb:GetItem'], Resource: [tableArn('PlayerStats')] },
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
const envFile = jsonFile('env.json', { Variables: { REGION } });
for (const { zip, fn } of ROUTES) {
  const exists = read(`lambda get-function-configuration --function-name ${fn}`, { allowFail: true });
  if (!exists) {
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      ok = DRY || !!aws(
        `lambda create-function --function-name ${fn} --runtime ${RUNTIME} --role ${roleArn} ` +
          `--handler index.handler --zip-file ${fileb('dist-reality', zip)} --timeout 15 --memory-size 256 ` +
          (layers.length ? `--layers ${layers.join(' ')} ` : '') +
          `--environment ${envFile}`,
        { allowFail: true }
      );
      if (!ok) { console.log('역할 전파 대기 후 다시 시도'); await sleep(6000); }
    }
    if (!ok) throw new Error(`create-function failed: ${fn}`);
    if (!DRY) aws(`lambda wait function-active-v2 --function-name ${fn}`, { json: false });
  } else {
    aws(`lambda update-function-code --function-name ${fn} --zip-file ${fileb('dist-reality', zip)}`);
    if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
  }
}

// 3. API
const resources = read(`apigateway get-resources --rest-api-id ${API_ID} --limit 500`).items;
const root = resources.find((r) => r.path === '/');
let changed = false;
for (const { fn, method, path } of ROUTES) {
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
if (changed) aws(`apigateway create-deployment --rest-api-id ${API_ID} --stage-name ${STAGE} --description "reality ${new Date().toISOString()}"`);

// 5. 기기 검사
if (!DRY) execSync(`node wrap-device-guard.mjs --only ${ROUTES.map((r) => r.fn).join(',')}`, { stdio: 'inherit' });
console.log('완료.');
