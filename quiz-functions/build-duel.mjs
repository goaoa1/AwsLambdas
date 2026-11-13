// ========================================
// build-duel.mjs - 대결 모드 D6 Lambda 묶기 (2026-11-13)
//   node build-duel.mjs → dist-duel/<name>.zip
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const DUEL_FUNCTIONS = ['getDuel', 'updateDuel'];
const outRoot = 'dist-duel';
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

for (const name of DUEL_FUNCTIONS) {
  const dir = join(outRoot, name);
  mkdirSync(dir, { recursive: true });
  await build({ ...common, entryPoints: [`${name}.ts`], outfile: join(dir, 'index.mjs') });
  execSync(`C:/Windows/System32/tar.exe -a -c -f ${name}.zip -C ${name} index.mjs`, { cwd: outRoot, stdio: 'inherit' });
  console.log(`built ${outRoot}/${name}.zip`);
}
console.log('done');
