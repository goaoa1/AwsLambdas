// ========================================
// build-skills.mjs - 캐릭터 스킬 1단계 Lambda 묶기 (StartQuizSession, ProcessQuestionAnswer)
//   node build-skills.mjs → dist-skills/<name>.zip
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const SKILL_FUNCTIONS = ['startQuizSession', 'processQuestionAnswer'];
const outRoot = 'dist-skills';
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

for (const name of SKILL_FUNCTIONS) {
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
