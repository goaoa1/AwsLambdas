// ========================================
// build-story.mjs - 스토리 3단계 Lambda 묶기 (2026-11-09)
//   node build-story.mjs → dist-story/<name>.zip
//   상점 함수(getShop/purchaseOutfit)도 storyStore 를 쓰게 바뀌었으니 배포 전에 node build-shop.mjs 도 다시 돌린다.
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const STORY_FUNCTIONS = ['getStory', 'updateStory', 'claimStoryUnlock'];
const outRoot = 'dist-story';
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: ['quiz-utils/*', '@aws-sdk/*', '@aws-lambda-powertools/*', '@middy/*'],
  logLevel: 'warning',
};

for (const name of STORY_FUNCTIONS) {
  const dir = join(outRoot, name);
  mkdirSync(dir, { recursive: true });
  await build({ ...common, entryPoints: [`${name}.ts`], outfile: join(dir, 'index.mjs') });
  execSync(`C:/Windows/System32/tar.exe -a -c -f ${name}.zip -C ${name} index.mjs`, { cwd: outRoot, stdio: 'inherit' });
  console.log(`built ${outRoot}/${name}.zip`);
}
console.log('done');
