// ========================================
// build-titles.mjs - 도전과제 3단계(칭호) Lambda 묶기
//   node build-titles.mjs → dist-titles/<name>.zip
//   새 EquipTitle + 칭호를 함께 보내도록 바뀐 프로필·친구 함수들
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const TITLE_FUNCTIONS = ['equipTitle', 'getMyProfile', 'setNickname', 'getFriends', 'searchPlayers', 'getFriendProfile'];
const outRoot = 'dist-titles';
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

for (const name of TITLE_FUNCTIONS) {
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
  execSync(`C:/Windows/System32/tar.exe -a -c -f ${name}.zip -C ${name} index.mjs`, { cwd: outRoot, stdio: 'inherit' });
  console.log(`built ${outRoot}/${name}.zip`);
}
console.log('done');
