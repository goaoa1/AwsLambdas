// ========================================
// deploy-skills.mjs - 캐릭터 스킬 1단계 배포 (aws cli, 프로필 inchul, ap-northeast-2)
//   먼저:  node build-skills.mjs
//   실행:  node deploy-skills.mjs [--dry]
//   1. StartQuizSession 역할에 PlayerResources GetItem (SelectedCharacterId 읽기) - TT_ReadSelectedCharacter
//   2. StartQuizSession / ProcessQuestionAnswer 코드 갱신
//   3. 기기 검사 다시 끼우기 (wrap-device-guard.mjs --only ...): 코드를 새로 올리면 검사가 빠지기 때문
// ========================================
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const PROFILE = 'inchul';
const REGION = 'ap-northeast-2';
const DRY = process.argv.includes('--dry');
const FUNCTIONS = [
  { zip: 'startQuizSession', fn: 'StartQuizSession' },
  { zip: 'processQuestionAnswer', fn: 'ProcessQuestionAnswer' },
];

function aws(args, { json = true, mutating = true } = {}) {
  const cmd = `aws ${args} --profile ${PROFILE} --region ${REGION}${json ? ' --output json' : ''}`;
  console.log(`$ ${cmd}`);
  if (DRY && mutating) return null;
  const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return json && out.trim() ? JSON.parse(out) : out;
}
const read = (args) => aws(args, { mutating: false });
const tmp = mkdtempSync(join(tmpdir(), 'skills-deploy-'));

const accountId = read(`sts get-caller-identity`).Account;
const startRole = read(`lambda get-function-configuration --function-name StartQuizSession`).Role.split('/').pop();
const policy = join(tmp, 'policy.json');
writeFileSync(policy, JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Action: ['dynamodb:GetItem'], Resource: [`arn:aws:dynamodb:${REGION}:${accountId}:table/PlayerResources`] }],
}));
aws(`iam put-role-policy --role-name ${startRole} --policy-name TT_ReadSelectedCharacter --policy-document file://${policy.replace(/\\/g, '/')}`);

for (const { zip, fn } of FUNCTIONS) {
  const p = resolve('dist-skills', `${zip}.zip`);
  if (!existsSync(p)) throw new Error(`${p} 가 없습니다. 먼저 node build-skills.mjs`);
  aws(`lambda update-function-code --function-name ${fn} --zip-file fileb://${p.replace(/\\/g, '/')}`);
  if (!DRY) aws(`lambda wait function-updated-v2 --function-name ${fn}`, { json: false });
}

const only = FUNCTIONS.map((f) => f.fn).join(',');
console.log(`\n기기 검사 다시 끼우기: ${only}`);
if (!DRY) execSync(`node wrap-device-guard.mjs --only ${only}`, { stdio: 'inherit' });
console.log('완료');
