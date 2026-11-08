// ========================================
// build-friends.mjs - 친구 기능 Lambda 를 esbuild 로 묶어 zip 으로 만든다 (build-shop.mjs 와 같은 방식)
//   node build-friends.mjs   → dist-friends/<name>.zip
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const FRIEND_FUNCTIONS = [
  'getMyProfile', 'setNickname',
  // 2단계
  'getFriends', 'searchPlayers', 'sendFriendRequest', 'respondFriendRequest', 'removeFriend', 'blockPlayer',
  // 3단계
  'getFriendProfile', 'updateBestRecords',
  // 4단계
  'sendGift', 'claimGifts',
];

const outRoot = 'dist-friends';
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

for (const name of FRIEND_FUNCTIONS) {
  const dir = join(outRoot, name);
  mkdirSync(dir, { recursive: true });
  await build({
    entryPoints: [`${name}.ts`],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: join(dir, 'index.mjs'),
    external: ['quiz-utils/*', '@aws-sdk/*', '@aws-lambda-powertools/*', '@middy/*'],
    logLevel: 'warning',
  });
  const zip = join(outRoot, `${name}.zip`);
  if (existsSync(zip)) rmSync(zip);
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${join(dir, 'index.mjs')}' -DestinationPath '${zip}' -Force"`, {
    stdio: 'inherit',
  });
  console.log(`built ${zip}`);
}
console.log('done');
