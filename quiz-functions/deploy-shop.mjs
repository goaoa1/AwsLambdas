// ========================================
// deploy-shop.mjs - 상점 Lambda 배포 (aws cli, 프로필 inchul, ap-northeast-2)
//   먼저:  aws sso login --profile inchul
//          node build-shop.mjs
//   실행:  node deploy-shop.mjs [--dry]
//
//   실제 환경(2026-11-07 확인): REST API(apigateway v1) QuizInGameAPI 7sgqi34u0h, 스테이지 stage_1,
//   Cognito 인가자 lu3670, 함수 이름은 PascalCase(SelectCharacter, RecordPlayerInfo ...), 레이어 quiz-utils:33,
//   함수마다 콘솔이 만든 service-role 을 쓰고 DynamoDB 권한은 관리형 정책 TT_AccessPlayerResourceTable /
//   TT_AccessIdempotencyTable 로 준다.
//
//   하는 일
//   1. DynamoDB 테이블 PurchaseReceipts(PK PurchaseToken) 가 없으면 생성
//   2. IAM 역할 TT_ShopLambdaRole 이 없으면 생성 (Lambda 기본 로그 + 위 관리형 정책 2개 + PurchaseReceipts PutItem)
//   3. Lambda GetShop / PurchaseOutfit / EquipOutfit / PurchaseCredits 생성 또는 코드·환경 변수 갱신
//   4. RecordPlayerInfo 코드 갱신 (Credits / OwnedOutfits / EquippedOutfits 응답 추가)
//   5. REST API 에 리소스+메서드 추가: GET /get-shop, POST /purchase-outfit, /equip-outfit, /purchase-credits
//      (Cognito 인가자, AWS_PROXY 통합, Lambda 호출 권한) 뒤 stage_1 에 배포
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
const TEMPLATE_FUNCTION = 'SelectCharacter';   // 레이어 ARN 을 여기서 읽는다
const RUNTIME = 'nodejs22.x';
const ROLE_NAME = 'TT_ShopLambdaRole';
const RECEIPT_TABLE = 'PurchaseReceipts';
const DRY = process.argv.includes('--dry');

// 구글 결제 검증 설정 (Play Console 에서 발급). 비워 두면 Platform 'google' 요청은 402 로 거부된다.
const GOOGLE_PACKAGE_NAME = process.env.GOOGLE_PACKAGE_NAME || '';
const GOOGLE_SA_EMAIL = process.env.GOOGLE_SA_EMAIL || '';
const GOOGLE_SA_PRIVATE_KEY = process.env.GOOGLE_SA_PRIVATE_KEY || '';
// 개발 스테이지에서는 true 로 두어 에디터/PIE 에서 샌드박스 결제로 크레딧을 받을 수 있게 한다
const ALLOW_SANDBOX_PURCHASE = process.env.ALLOW_SANDBOX_PURCHASE ?? 'true';

// zip 파일 이름(build-shop.mjs, camelCase) → Lambda 함수 이름(PascalCase)
const ROUTES = [
  { zip: 'getShop',         fn: 'GetShop',         method: 'GET',  path: 'get-shop' },
  { zip: 'purchaseOutfit',  fn: 'PurchaseOutfit',  method: 'POST', path: 'purchase-outfit' },
  { zip: 'equipOutfit',     fn: 'EquipOutfit',     method: 'POST', path: 'equip-outfit' },
  { zip: 'purchaseCredits', fn: 'PurchaseCredits', method: 'POST', path: 'purchase-credits' },
];

const tmp = mkdtempSync(join(tmpdir(), 'shop-deploy-'));

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
  const p = resolve('dist-shop', `${zip}.zip`);
  if (!existsSync(p)) throw new Error(`${p} 가 없습니다. 먼저 node build-shop.mjs 를 실행하세요.`);
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

// 1. 영수증 테이블
if (!read(`dynamodb describe-table --table-name ${RECEIPT_TABLE}`, { allowFail: true })) {
  aws(
    `dynamodb create-table --table-name ${RECEIPT_TABLE} ` +
      `--attribute-definitions AttributeName=PurchaseToken,AttributeType=S ` +
      `--key-schema AttributeName=PurchaseToken,KeyType=HASH --billing-mode PAY_PER_REQUEST`
  );
  if (!DRY) aws(`dynamodb wait table-exists --table-name ${RECEIPT_TABLE}`, { json: false });
} else {
  console.log(`table exists: ${RECEIPT_TABLE}`);
}

// 2. 실행 역할
let roleArn = `arn:aws:iam::${accountId}:role/${ROLE_NAME}`;
const existingRole = read(`iam get-role --role-name ${ROLE_NAME}`, { allowFail: true });
if (!existingRole) {
  const trust = jsonFile('trust.json', {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
  });
  const created = aws(`iam create-role --role-name ${ROLE_NAME} --assume-role-policy-document ${trust} --description "TimesTable shop Lambdas"`);
  if (created) roleArn = created.Role.Arn;
  for (const policy of [
    'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    `arn:aws:iam::${accountId}:policy/TT_AccessPlayerResourceTable`,
    `arn:aws:iam::${accountId}:policy/TT_AccessIdempotencyTable`,
  ]) {
    aws(`iam attach-role-policy --role-name ${ROLE_NAME} --policy-arn ${policy}`);
  }
  const receipts = jsonFile('receipts.json', {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: ['dynamodb:PutItem'], Resource: `arn:aws:dynamodb:${REGION}:${accountId}:table/${RECEIPT_TABLE}` }],
  });
  aws(`iam put-role-policy --role-name ${ROLE_NAME} --policy-name TT_AccessPurchaseReceipts --policy-document ${receipts}`);
  if (!DRY) {
    console.log('IAM 전파 대기 12초');
    await sleep(12000);
  }
} else {
  roleArn = existingRole.Role.Arn;
  console.log(`role exists: ${roleArn}`);
}

// 3. Lambda 생성/갱신
const shopEnv = {
  REGION,
  IDEMPOTENCY_TABLE: 'IdempotencyTable',
  RECEIPT_TABLE,
  ALLOW_SANDBOX_PURCHASE,
  GOOGLE_PACKAGE_NAME,
  GOOGLE_SA_EMAIL,
  GOOGLE_SA_PRIVATE_KEY,
};
const envFile = jsonFile('env.json', { Variables: Object.fromEntries(Object.entries(shopEnv).filter(([, v]) => v !== '')) });

for (const { zip, fn } of ROUTES) {
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
    aws(`lambda update-function-configuration --function-name ${fn} --environment ${envFile}`);
    if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
  }
}

// 4. RecordPlayerInfo 코드만 갱신
aws(`lambda update-function-code --function-name RecordPlayerInfo --zip-file ${fileb('recordPlayerInfo')}`);
if (!DRY) aws(`lambda wait function-updated-v2 --function-name RecordPlayerInfo`, { json: false });

// 5. REST API 리소스·메서드
const resources = read(`apigateway get-resources --rest-api-id ${API_ID}`).items;
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
  aws(`apigateway create-deployment --rest-api-id ${API_ID} --stage-name ${STAGE} --description "shop ${new Date().toISOString()}"`);
}

console.log(`
완료. 엔드포인트: https://${API_ID}.execute-api.${REGION}.amazonaws.com/${STAGE}/get-shop 등
역할 ${roleArn} (PlayerResources / IdempotencyTable / PurchaseReceipts)
`);
