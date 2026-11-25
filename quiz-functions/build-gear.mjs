// ========================================
// build-gear.mjs - 장비 · 스킬 G1 Lambda 묶기 (2026-11-25 — 게임 저장소 Docs/장비_스킬_계획.md)
//   node build-gear.mjs → dist-gear/<name>.zip
//   (FinishBattle 의 보상은 build-battle.mjs 가 묶는다 — gearRewards.ts 를 같이 넣음)
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const GEAR_FUNCTIONS = ['getGear', 'equipGear', 'levelSkill', 'buyGear'];
const outRoot = 'dist-gear';
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

for (const name of GEAR_FUNCTIONS) {
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
