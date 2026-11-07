// ========================================
// build-shop.mjs - 상점 Lambda 4개 + recordPlayerInfo 를 esbuild 로 묶어 zip 으로 만든다
//   node build-shop.mjs            → dist-shop/<name>.zip
//   상점 함수는 shopCatalog.ts / shopState.ts 를 같이 쓰므로 tsc 단일 파일 복사로는 안 되고
//   esbuild 로 한 파일(index.mjs)에 묶는다. 레이어(quiz-utils)와 AWS SDK 는 external 로 둔다.
// ========================================
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

export const SHOP_FUNCTIONS = ['getShop', 'purchaseOutfit', 'equipOutfit', 'purchaseCredits', 'recordPlayerInfo'];

const outRoot = 'dist-shop';
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

for (const name of SHOP_FUNCTIONS) {
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

// 예전 흐름(함수 폴더에 <name>.zip)과 맞추기 위해 복사본도 둔다
for (const name of SHOP_FUNCTIONS) {
  copyFileSync(join(outRoot, `${name}.zip`), `${name}.zip`);
}
console.log('done');
