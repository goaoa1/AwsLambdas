// ========================================
// deploy-titles.mjs - 도전과제 3단계(칭호) 배포 (aws cli, 프로필 inchul, ap-northeast-2)
//   먼저:  node build-titles.mjs
//   실행:  node deploy-titles.mjs [--dry]
//   1. TT_FriendLambdaRole 에 PlayerAchievements 읽기(Query) 추가 (EquipTitle 이 받은 칭호를 확인)
//   2. Lambda EquipTitle 새로 만들기 (역할 TT_FriendLambdaRole)
//   3. REST: POST /equip-title → stage_1 배포
//   4. 칭호를 함께 보내는 GetMyProfile / SetNickname / GetFriends / SearchPlayers / GetFriendProfile 코드 갱신
//   5. 기기 검사 끼우기 (위 6개)
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
const ROLE_NAME = 'TT_FriendLambdaRole';
const DRY = process.argv.includes('--dry');

const NEW_ROUTES = [{ zip: 'equipTitle', fn: 'EquipTitle', method: 'POST', path: 'equip-title' }];
const UPDATED = [
  { zip: 'getMyProfile', fn: 'GetMyProfile' },
  { zip: 'setNickname', fn: 'SetNickname' },
  { zip: 'getFriends', fn: 'GetFriends' },
  { zip: 'searchPlayers', fn: 'SearchPlayers' },
  { zip: 'getFriendProfile', fn: 'GetFriendProfile' },
];

const tmp = mkdtempSync(join(tmpdir(), 'titles-deploy-'));
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
  const p = resolve('dist-titles', `${zip}.zip`);
  if (!existsSync(p)) throw new Error(`${p} 가 없습니다. 먼저 node build-titles.mjs 를 실행하세요.`);
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
const roleArn = read(`iam get-role --role-name ${ROLE_NAME}`).Role.Arn;

// 1. 역할에 PlayerAchievements 읽기 추가 (기존 정책은 그대로 두고 따로 붙인다)
aws(
  `iam put-role-policy --role-name ${ROLE_NAME} --policy-name TT_ReadAchievementsForTitles --policy-document ${jsonFile('policy.json', {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: ['dynamodb:Query', 'dynamodb:GetItem'], Resource: [tableArn('PlayerAchievements')] }],
  })}`
);

// 2. EquipTitle
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

// 3. API
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
if (changed) aws(`apigateway create-deployment --rest-api-id ${API_ID} --stage-name ${STAGE} --description "titles ${new Date().toISOString()}"`);

// 4. 칭호를 보내도록 바뀐 함수들
for (const { zip, fn } of UPDATED) {
  aws(`lambda update-function-code --function-name ${fn} --zip-file ${fileb(zip)}`);
  if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
}

// 5. 기기 검사
const all = [...NEW_ROUTES, ...UPDATED].map((r) => r.fn).join(',');
if (!DRY) execSync(`node wrap-device-guard.mjs --only ${all}`, { stdio: 'inherit' });
console.log('완료');
