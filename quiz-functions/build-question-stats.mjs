// ========================================
// build-question-stats.mjs - 문제별 정답률 Lambda 묶기 (2026-11-09)
//   node build-question-stats.mjs → dist-question-stats/<name>.zip
//   ProcessQuestionAnswer (채점마다 PlayerQuestionStats 에 더함) + 새 GetQuestionStats
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const STATS_FUNCTIONS = ['processQuestionAnswer', 'getQuestionStats'];
const outRoot = 'dist-question-stats';
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

for (const name of STATS_FUNCTIONS) {
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
