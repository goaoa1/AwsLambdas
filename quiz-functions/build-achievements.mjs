// ========================================
// build-achievements.mjs - 도전과제 1단계 Lambda 묶기
//   node build-achievements.mjs → dist-achievements/<name>.zip, dist-achievements/backfill.cjs (로컬 실행용)
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const ACHIEVEMENT_FUNCTIONS = ['getAchievements', 'claimAchievement', 'updateAchievementStats'];
const outRoot = 'dist-achievements';
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

for (const name of ACHIEVEMENT_FUNCTIONS) {
  const dir = join(outRoot, name);
  mkdirSync(dir, { recursive: true });
  await build({ ...common, entryPoints: [`${name}.ts`], outfile: join(dir, 'index.mjs') });
  execSync(`C:/Windows/System32/tar.exe -a -c -f ${name}.zip -C ${name} index.mjs`, { cwd: outRoot, stdio: 'inherit' });
  console.log(`built ${outRoot}/${name}.zip`);
}

// 지난 기록 채우기 (로컬에서 node 로 실행, aws sdk 는 node_modules 의 것을 씀)
// (esm 으로 묶으면 sdk 안의 require 가 깨져서 cjs 로)
await build({ ...common, format: 'cjs', external: [], entryPoints: ['backfillAchievementStats.ts'], outfile: join(outRoot, 'backfill.cjs') });
console.log(`built ${outRoot}/backfill.cjs`);
console.log('done');
