// ========================================
// deploy-achievements.mjs - 도전과제 1단계 배포 (aws cli, 프로필 inchul, ap-northeast-2)
//   먼저:  node build-achievements.mjs && node build-friends.mjs && node build-skills.mjs
//   실행:  node deploy-achievements.mjs [--dry]
//   1. 테이블 PlayerStats (PK PlayerID), PlayerAchievements (PK PlayerID, SK AchievementId)
//   2. 역할 TT_AchievementLambdaRole (위 두 테이블, PlayerResources 읽기/쓰기, Friends 조회, QuizResults 스트림)
//   3. Lambda GetAchievements / ClaimAchievement / UpdateAchievementStats (+ QuizResults 스트림 연결)
//   4. REST: GET /get-achievements, POST /claim-achievement → stage_1 배포
//   5. SendGift(선물 횟수 세기): TT_FriendLambdaRole 에 PlayerStats 쓰기 + 코드 갱신
//   6. ProcessQuestionAnswer(한 판 기록 WrongCount/LuckyHits/FocusMaxHit): deploy-skills.mjs
//   7. 기기 검사 끼우기: 새 경로 2개와 SendGift
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
const ROLE_NAME = 'TT_AchievementLambdaRole';
const STATS_TABLE = 'PlayerStats';
const ACH_TABLE = 'PlayerAchievements';
const RESULTS_TABLE = 'QuizResults';
const DRY = process.argv.includes('--dry');

const ROUTES = [
  { zip: 'getAchievements', fn: 'GetAchievements', method: 'GET', path: 'get-achievements' },
  { zip: 'claimAchievement', fn: 'ClaimAchievement', method: 'POST', path: 'claim-achievement' },
];
const STREAM_FUNCTIONS = [{ zip: 'updateAchievementStats', fn: 'UpdateAchievementStats' }];

const tmp = mkdtempSync(join(tmpdir(), 'ach-deploy-'));
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

// 1. 테이블
if (!read(`dynamodb describe-table --table-name ${STATS_TABLE}`, { allowFail: true })) {
  aws(`dynamodb create-table --table-name ${STATS_TABLE} --attribute-definitions AttributeName=PlayerID,AttributeType=S --key-schema AttributeName=PlayerID,KeyType=HASH --billing-mode PAY_PER_REQUEST`);
  if (!DRY) aws(`dynamodb wait table-exists --table-name ${STATS_TABLE}`, { json: false });
}
if (!read(`dynamodb describe-table --table-name ${ACH_TABLE}`, { allowFail: true })) {
  aws(
    `dynamodb create-table --table-name ${ACH_TABLE} ` +
      `--attribute-definitions AttributeName=PlayerID,AttributeType=S AttributeName=AchievementId,AttributeType=S ` +
      `--key-schema AttributeName=PlayerID,KeyType=HASH AttributeName=AchievementId,KeyType=RANGE --billing-mode PAY_PER_REQUEST`
  );
  if (!DRY) aws(`dynamodb wait table-exists --table-name ${ACH_TABLE}`, { json: false });
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
  const created = aws(`iam create-role --role-name ${ROLE_NAME} --assume-role-policy-document ${trust} --description "TimesTable achievements"`);
  if (created) roleArn = created.Role.Arn;
  aws(`iam attach-role-policy --role-name ${ROLE_NAME} --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`);
  newRole = true;
} else {
  roleArn = existingRole.Role.Arn;
}
aws(
  `iam put-role-policy --role-name ${ROLE_NAME} --policy-name TT_AccessAchievementTables --policy-document ${jsonFile('policy.json', {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:PutItem', 'dynamodb:Query'], Resource: [tableArn(STATS_TABLE), tableArn(ACH_TABLE)] },
      { Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:ConditionCheckItem'], Resource: [tableArn('PlayerResources')] },
      { Effect: 'Allow', Action: ['dynamodb:Query'], Resource: [tableArn('Friends')] },
      // 기기 검사(deviceGuard)용
      { Effect: 'Allow', Action: ['dynamodb:GetItem'], Resource: [tableArn('PlayerDevices')] },
      {
        Effect: 'Allow',
        Action: ['dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:DescribeStream', 'dynamodb:ListStreams'],
        Resource: [`${tableArn(RESULTS_TABLE)}/stream/*`],
      },
    ],
  })}`
);
if (newRole && !DRY) {
  console.log('IAM 전파 대기 12초');
  await sleep(12000);
}

// 3. Lambda
const envFile = jsonFile('env.json', { Variables: { REGION } });
for (const { zip, fn } of [...ROUTES, ...STREAM_FUNCTIONS]) {
  const exists = read(`lambda get-function-configuration --function-name ${fn}`, { allowFail: true });
  if (!exists) {
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      ok = DRY || !!aws(
        `lambda create-function --function-name ${fn} --runtime ${RUNTIME} --role ${roleArn} ` +
          `--handler index.handler --zip-file ${fileb('dist-achievements', zip)} --timeout 15 --memory-size 256 ` +
          (layers.length ? `--layers ${layers.join(' ')} ` : '') +
          `--environment ${envFile}`,
        { allowFail: true }
      );
      if (!ok) { console.log('역할 전파 대기 후 다시 시도'); await sleep(6000); }
    }
    if (!ok) throw new Error(`create-function failed: ${fn}`);
    if (!DRY) aws(`lambda wait function-active-v2 --function-name ${fn}`, { json: false });
  } else {
    aws(`lambda update-function-code --function-name ${fn} --zip-file ${fileb('dist-achievements', zip)}`);
    if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
  }
}

// 3-b. QuizResults 스트림 → UpdateAchievementStats
{
  const desc = read(`dynamodb describe-table --table-name ${RESULTS_TABLE}`).Table;
  const streamArn = desc.LatestStreamArn;
  if (!streamArn) throw new Error('QuizResults 스트림이 꺼져 있습니다 (deploy-friends.mjs 가 켬)');
  for (const { fn } of STREAM_FUNCTIONS) {
    const maps = read(`lambda list-event-source-mappings --function-name ${fn}`, { allowFail: true })?.EventSourceMappings ?? [];
    if (!maps.some((m) => m.EventSourceArn === streamArn)) {
      let ok = false;
      for (let attempt = 0; attempt < 5 && !ok; attempt++) {
        ok = DRY || !!aws(
          `lambda create-event-source-mapping --function-name ${fn} --event-source-arn ${streamArn} ` +
            `--starting-position LATEST --batch-size 20 --maximum-retry-attempts 5`,
          { allowFail: true }
        );
        if (!ok) { console.log('권한 전파 대기 후 다시 시도'); await sleep(8000); }
      }
      if (!ok) throw new Error(`event source mapping failed: ${fn}`);
    }
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
if (changed) aws(`apigateway create-deployment --rest-api-id ${API_ID} --stage-name ${STAGE} --description "achievements ${new Date().toISOString()}"`);

// 5. SendGift: 선물 횟수 세기
aws(
  `iam put-role-policy --role-name TT_FriendLambdaRole --policy-name TT_WritePlayerStats --policy-document ${jsonFile('gift-policy.json', {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: ['dynamodb:UpdateItem'], Resource: [tableArn(STATS_TABLE)] }],
  })}`
);
aws(`lambda update-function-code --function-name SendGift --zip-file ${fileb('dist-friends', 'sendGift')}`);
if (!DRY) aws(`lambda wait function-updated-v2 --function-name SendGift`, { json: false });

// 6. ProcessQuestionAnswer (+ StartQuizSession, 같은 묶음): 기기 검사도 다시 끼운다
if (!DRY) execSync('node deploy-skills.mjs', { stdio: 'inherit' });

// 7. 기기 검사
if (!DRY) execSync('node wrap-device-guard.mjs --only GetAchievements,ClaimAchievement,SendGift', { stdio: 'inherit' });
console.log('완료. 다음: 지난 기록 채우기 (node dist-achievements/backfill.cjs --dry 로 먼저 확인)');
