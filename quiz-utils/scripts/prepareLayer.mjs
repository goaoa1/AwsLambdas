import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetDir = join(__dirname, '..', 'nodejs', 'node_modules', 'quiz-utils');

mkdirSync(targetDir, { recursive: true });

const pkg = {
  name: 'quiz-utils',
  version: '1.0.0',
  type: 'module',
  exports: {
    './*': './*.js',
  },
};

writeFileSync(
  join(targetDir, 'package.json'),
  JSON.stringify(pkg, null, 2) + '\n'
);

console.log('Layer prepared: nodejs/node_modules/quiz-utils/package.json written');
