// ========================================
// deploy-achievement-code.mjs - 도전과제 목록만 바뀌었을 때: GetAchievements · ClaimAchievement 코드만 갱신 (전투 도전과제, 2026-11-24)
//   먼저: node build-achievements.mjs        실행: node deploy-achievement-code.mjs [--dry]
//   역할 · 경로 · 테이블 · 스트림은 그대로 둔다 (deploy-achievements.mjs 가 만든 것 — 그 스크립트는 SendGift · ProcessQuestionAnswer 까지
//   다시 올려서 목록만 바뀐 때는 쓰지 않는다). 갱신 뒤 기기 검사를 다시 끼운다 (wrap-device-guard --only).
//   UpdateAchievementStats(스트림)는 목록을 쓰지 않아 그대로 둔다.
//   주의: 칭호 이름(TITLES)을 쓰는 친구 · 프로필 · 순위 함수(build-friends · build-titles — EquipTitle, GetMyProfile, GetFriends …)는
//         새 칭호 단계(마물 3000 · 암송 1000 · 끊기 100)에 누군가 닿기 전에 따로 다시 올린다.
// ========================================
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PROFILE = 'inchul';
const REGION = 'ap-northeast-2';
const DRY = process.argv.includes('--dry');
const TARGETS = [
  { zip: 'getAchievements', fn: 'GetAchievements' },
  { zip: 'claimAchievement', fn: 'ClaimAchievement' },
];

function aws(args, json = true) {
  const cmd = `aws ${args} --profile ${PROFILE} --region ${REGION}${json ? ' --output json' : ''}`;
  console.log(`$ ${cmd}`);
  if (DRY) return null;
  const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return json && out.trim() ? JSON.parse(out) : out;
}

for (const { zip, fn } of TARGETS) {
  const p = resolve('dist-achievements', `${zip}.zip`);
  if (!existsSync(p)) throw new Error(`${p} 가 없습니다. 먼저 node build-achievements.mjs`);
  aws(`lambda update-function-code --function-name ${fn} --zip-file fileb://${p.replace(/\\/g, '/')}`);
  aws(`lambda wait function-updated-v2 --function-name ${fn}`, false);
}
if (!DRY) execSync(`node wrap-device-guard.mjs --only ${TARGETS.map((t) => t.fn).join(',')}`, { stdio: 'inherit' });
console.log('완료.');
