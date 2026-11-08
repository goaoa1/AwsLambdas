// ========================================
// build-device.mjs - '한 계정 한 기기' Lambda 묶기
//   node build-device.mjs → dist-device/
//     claimDevice.zip, checkDevice.zip          새 Lambda
//     guard-mjs/index.mjs, guard-js/index.mjs   다른 Lambda 앞에 끼울 검사 (원래 코드가 inner.mjs / inner.js 일 때)
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outRoot = 'dist-device';
// originals/ (wrap-device-guard 가 보관한 원래 zip) 는 지우지 않는다
for (const sub of ['claimDevice', 'checkDevice', 'guard-mjs', 'guard-js', 'claimDevice.zip', 'checkDevice.zip']) {
  rmSync(join(outRoot, sub), { recursive: true, force: true });
}
mkdirSync(outRoot, { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: ['quiz-utils/*', '@aws-sdk/*', '@aws-lambda-powertools/*', '@middy/*'],
  logLevel: 'warning',
};

for (const name of ['claimDevice', 'checkDevice']) {
  const dir = join(outRoot, name);
  mkdirSync(dir, { recursive: true });
  await build({ ...common, entryPoints: [`${name}.ts`], outfile: join(dir, 'index.mjs') });
  execSync(`C:/Windows/System32/tar.exe -a -c -f ${name}.zip -C ${name} index.mjs`, { cwd: outRoot, stdio: 'inherit' });
  console.log(`built ${outRoot}/${name}.zip`);
}

// 원래 코드를 정적 import 하는 판 두 개 (inner.mjs / inner.js)
const guardSrc = readFileSync('guardEntry.ts', 'utf8');
for (const [variant, inner] of [['guard-mjs', './inner.mjs'], ['guard-js', './inner.js']]) {
  const entry = `guardEntry.${variant}.tmp.ts`;
  writeFileSync(entry, guardSrc.replace("from './inner.mjs'", `from '${inner}'`));
  try {
    await build({
      ...common,
      entryPoints: [entry],
      outfile: join(outRoot, variant, 'index.mjs'),
      external: [...common.external, './inner.mjs', './inner.js'],
    });
  } finally {
    rmSync(entry, { force: true });
  }
  console.log(`built ${outRoot}/${variant}/index.mjs`);
}
console.log('done');
