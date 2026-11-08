// ========================================
// deploy-friends.mjs - 친구 기능 Lambda 배포 (aws cli, 프로필 inchul, ap-northeast-2). deploy-shop.mjs 와 같은 방식
//   먼저:  aws sso login --profile inchul
//          node build-friends.mjs
//   실행:  node deploy-friends.mjs [--dry]
//
//   1단계(닉네임·친구 코드)에서 하는 일
//   1. DynamoDB 테이블
//      PlayerProfiles (PK PlayerID, GSI NicknameIndex: PK Nickname / SK NicknameTag(N))
//      PlayerHandles  (PK Handle)  - 'CODE#…' / 'NICK#…#번호' 를 한 사람에게만 주는 자리표
//   2. IAM 역할 TT_FriendLambdaRole (기본 로그 + 위 두 테이블 읽기/쓰기)
//   3. Lambda GetMyProfile / SetNickname
//   4. REST API: GET /get-my-profile, POST /set-nickname (Cognito 인가자) → stage_1 배포
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
const PROFILE_TABLE = 'PlayerProfiles';
const HANDLE_TABLE = 'PlayerHandles';
const FRIEND_TABLE = 'Friends';
const DRY = process.argv.includes('--dry');

const ROUTES = [
  { zip: 'getMyProfile', fn: 'GetMyProfile', method: 'GET',  path: 'get-my-profile' },
  { zip: 'setNickname',  fn: 'SetNickname',  method: 'POST', path: 'set-nickname' },
  // 2단계: 친구 관계
  { zip: 'getFriends',           fn: 'GetFriends',           method: 'GET',  path: 'get-friends' },
  { zip: 'searchPlayers',        fn: 'SearchPlayers',        method: 'POST', path: 'search-players' },
  { zip: 'sendFriendRequest',    fn: 'SendFriendRequest',    method: 'POST', path: 'send-friend-request' },
  { zip: 'respondFriendRequest', fn: 'RespondFriendRequest', method: 'POST', path: 'respond-friend-request' },
  { zip: 'removeFriend',         fn: 'RemoveFriend',         method: 'POST', path: 'remove-friend' },
  { zip: 'blockPlayer',          fn: 'BlockPlayer',          method: 'POST', path: 'block-player' },
  // 3단계: 프로필
  { zip: 'getFriendProfile',     fn: 'GetFriendProfile',     method: 'POST', path: 'get-friend-profile' },
  // 4단계: 선물
  { zip: 'sendGift',             fn: 'SendGift',             method: 'POST', path: 'send-gift' },
  { zip: 'claimGifts',           fn: 'ClaimGifts',           method: 'POST', path: 'claim-gifts' },
];
// API 경로 없이 이벤트로 도는 함수 (3단계: QuizResults 스트림 → 단별 최고 기록)
const STREAM_FUNCTIONS = [{ zip: 'updateBestRecords', fn: 'UpdateBestRecords' }];
const RESULTS_TABLE = 'QuizResults';

const tmp = mkdtempSync(join(tmpdir(), 'friend-deploy-'));

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
  const p = resolve('dist-friends', `${zip}.zip`);
  if (!existsSync(p)) throw new Error(`${p} 가 없습니다. 먼저 node build-friends.mjs 를 실행하세요.`);
  return `fileb://${p.replace(/\\/g, '/')}`;
}
function jsonFile(name, obj) {
  const p = join(tmp, name);
  writeFileSync(p, JSON.stringify(obj));
  return `file://${p.replace(/\\/g, '/')}`;
}

// 0. 계정·템플릿
const accountId = read(`sts get-caller-identity --query Account`, { json: false }).trim().replace(/"/g, '');
const template = read(`lambda get-function-configuration --function-name ${TEMPLATE_FUNCTION}`);
const layers = (template.Layers || []).map((l) => l.Arn);
console.log(`account=${accountId} layers=${layers.join(',')}`);

// 1. 테이블
if (!read(`dynamodb describe-table --table-name ${PROFILE_TABLE}`, { allowFail: true })) {
  const gsi = jsonFile('gsi.json', [
    {
      IndexName: 'NicknameIndex',
      KeySchema: [
        { AttributeName: 'Nickname', KeyType: 'HASH' },
        { AttributeName: 'NicknameTag', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
  ]);
  aws(
    `dynamodb create-table --table-name ${PROFILE_TABLE} ` +
      `--attribute-definitions AttributeName=PlayerID,AttributeType=S AttributeName=Nickname,AttributeType=S AttributeName=NicknameTag,AttributeType=N ` +
      `--key-schema AttributeName=PlayerID,KeyType=HASH --billing-mode PAY_PER_REQUEST ` +
      `--global-secondary-indexes ${gsi}`
  );
  if (!DRY) aws(`dynamodb wait table-exists --table-name ${PROFILE_TABLE}`, { json: false });
} else {
  console.log(`table exists: ${PROFILE_TABLE}`);
}
if (!read(`dynamodb describe-table --table-name ${HANDLE_TABLE}`, { allowFail: true })) {
  aws(
    `dynamodb create-table --table-name ${HANDLE_TABLE} ` +
      `--attribute-definitions AttributeName=Handle,AttributeType=S ` +
      `--key-schema AttributeName=Handle,KeyType=HASH --billing-mode PAY_PER_REQUEST`
  );
  if (!DRY) aws(`dynamodb wait table-exists --table-name ${HANDLE_TABLE}`, { json: false });
} else {
  console.log(`table exists: ${HANDLE_TABLE}`);
}

if (!read(`dynamodb describe-table --table-name ${FRIEND_TABLE}`, { allowFail: true })) {
  aws(
    `dynamodb create-table --table-name ${FRIEND_TABLE} ` +
      `--attribute-definitions AttributeName=PlayerID,AttributeType=S AttributeName=OtherID,AttributeType=S ` +
      `--key-schema AttributeName=PlayerID,KeyType=HASH AttributeName=OtherID,KeyType=RANGE --billing-mode PAY_PER_REQUEST`
  );
  if (!DRY) aws(`dynamodb wait table-exists --table-name ${FRIEND_TABLE}`, { json: false });
} else {
  console.log(`table exists: ${FRIEND_TABLE}`);
}

// 2. 실행 역할 (정책은 매번 덮어써서 단계가 늘면 같이 넓힌다)
let roleArn = `arn:aws:iam::${accountId}:role/${ROLE_NAME}`;
const existingRole = read(`iam get-role --role-name ${ROLE_NAME}`, { allowFail: true });
let newRole = false;
if (!existingRole) {
  const trust = jsonFile('trust.json', {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
  });
  const created = aws(`iam create-role --role-name ${ROLE_NAME} --assume-role-policy-document ${trust} --description "TimesTable friend Lambdas"`);
  if (created) roleArn = created.Role.Arn;
  aws(`iam attach-role-policy --role-name ${ROLE_NAME} --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`);
  newRole = true;
} else {
  roleArn = existingRole.Role.Arn;
  console.log(`role exists: ${roleArn}`);
}
const tableArn = (t) => `arn:aws:dynamodb:${REGION}:${accountId}:table/${t}`;
const policy = jsonFile('friend-tables.json', {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query', 'dynamodb:BatchGetItem', 'dynamodb:ConditionCheckItem'],
      Resource: [tableArn(PROFILE_TABLE), `${tableArn(PROFILE_TABLE)}/index/*`, tableArn(HANDLE_TABLE), tableArn(FRIEND_TABLE)],
    },
    // 3단계: 친구 프로필에 캐릭터·출석을 보여 주려고 PlayerResources 읽기만
    // 4단계: 선물 받기가 스태미나를 올린다 (GetItem + UpdateItem, 트랜잭션 조건 검사)
    { Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:ConditionCheckItem'], Resource: [tableArn('PlayerResources')] },
    // 3단계: QuizResults 스트림 읽기 (UpdateBestRecords)
    {
      Effect: 'Allow',
      Action: ['dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:DescribeStream', 'dynamodb:ListStreams'],
      Resource: [`${tableArn(RESULTS_TABLE)}/stream/*`],
    },
  ],
});
aws(`iam put-role-policy --role-name ${ROLE_NAME} --policy-name TT_AccessFriendTables --policy-document ${policy}`);
if (newRole && !DRY) {
  console.log('IAM 전파 대기 12초');
  await sleep(12000);
}

// 3. Lambda 생성/갱신
const envFile = jsonFile('env.json', { Variables: { REGION } });
for (const { zip, fn } of [...ROUTES, ...STREAM_FUNCTIONS]) {
  const exists = read(`lambda get-function-configuration --function-name ${fn}`, { allowFail: true });
  if (!exists) {
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      const r = aws(
        `lambda create-function --function-name ${fn} --runtime ${RUNTIME} --role ${roleArn} ` +
          `--handler index.handler --zip-file ${fileb(zip)} --timeout 15 --memory-size 256 ` +
          (layers.length ? `--layers ${layers.join(' ')} ` : '') +
          `--environment ${envFile}`,
        { allowFail: true }
      );
      ok = DRY || !!r;
      if (!ok) { console.log('역할 전파 대기 후 다시 시도'); await sleep(6000); }
    }
    if (!ok) throw new Error(`create-function failed: ${fn}`);
    if (!DRY) aws(`lambda wait function-active-v2 --function-name ${fn}`, { json: false });
  } else {
    aws(`lambda update-function-code --function-name ${fn} --zip-file ${fileb(zip)}`);
    if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
  }
}

// 3-b. QuizResults 스트림 켜기 + UpdateBestRecords 연결
{
  const desc = read(`dynamodb describe-table --table-name ${RESULTS_TABLE}`).Table;
  let streamArn = desc.LatestStreamArn;
  if (!desc.StreamSpecification?.StreamEnabled) {
    const r = aws(`dynamodb update-table --table-name ${RESULTS_TABLE} --stream-specification StreamEnabled=true,StreamViewType=NEW_IMAGE`);
    streamArn = r?.TableDescription?.LatestStreamArn;
    if (!DRY) { console.log('스트림 켜짐 대기 10초'); await sleep(10000); }
  }
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
    } else {
      console.log(`stream mapping exists: ${fn}`);
    }
  }
}

// 4. REST API 리소스·메서드
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
  aws(`apigateway create-deployment --rest-api-id ${API_ID} --stage-name ${STAGE} --description "friends ${new Date().toISOString()}"`);
}

console.log(`
완료. 엔드포인트: https://${API_ID}.execute-api.${REGION}.amazonaws.com/${STAGE}/get-my-profile, /set-nickname
역할 ${roleArn} (PlayerProfiles / PlayerHandles)
`);
