// ========================================
// export-gamedata-csv.mjs - 서버 카탈로그의 글자 → 앱 String Table CSV (다국어 2단계, 2026-11-09)
//   node export-gamedata-csv.mjs
//   → Unreal Projects/TimesTable/Content/StringTables/GameData.csv  (Key, SourceString, Comment; UTF-8 BOM)
//   앱은 LOCTABLE_FROMFILE_GAME("ST_GameData", "GameData", "StringTables/GameData.csv") 로 읽고,
//   서버가 보내는 ID(ItemId, 도전과제 Id, TitleId, 닉네임 단어)로 지금 언어 글자를 찾는다. 번역은 Strings.xlsx 에서.
//   서버 카탈로그(이 폴더의 *.ts)가 한국어 원문의 기준이다. 카탈로그를 고치면 이 스크립트를 다시 돌린다.
//   닉네임 단어는 번호가 주소라 순서를 바꾸거나 지우면 안 된다 (profileCatalog.ts 뒤에 더하기만).
// ========================================
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = 'C:/Users/inchul/Documents/Unreal Projects/TimesTable/Content/StringTables/GameData.csv';

const tmp = mkdtempSync(join(tmpdir(), 'gamedata-'));
const entry = join(tmp, 'entry.ts');
writeFileSync(
  entry,
  `export { ACHIEVEMENTS, TITLES } from ${JSON.stringify(join(process.cwd(), 'achievementCatalog.ts').replace(/\\/g, '/'))};
export { ITEMS } from ${JSON.stringify(join(process.cwd(), 'itemCatalog.ts').replace(/\\/g, '/'))};
export { NICKNAME_ADJECTIVES, NICKNAME_NOUNS } from ${JSON.stringify(join(process.cwd(), 'profileCatalog.ts').replace(/\\/g, '/'))};
`
);
const outfile = join(tmp, 'catalog.mjs');
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning', external: ['@aws-sdk/*', 'quiz-utils/*'] });
const C = await import(pathToFileURL(outfile).href);

const rows = [];
const add = (key, source, comment) => rows.push([key, source, comment]);

for (const i of C.ITEMS) {
  add(`Item.${i.ItemId}.Name`, i.Name, '물약 이름 (상점·가방·보상 목록)');
  add(`Item.${i.ItemId}.Desc`, i.Desc, '물약 설명 한 줄');
}
for (const a of C.ACHIEVEMENTS) {
  add(`Ach.${a.Id}.Name`, a.Name, `도전과제 이름 (분류 ${a.Category})`);
  add(`Ach.${a.Id}.Desc`, a.Desc, '도전과제 설명. {Goal} = 단계 목표 숫자 (그대로 둔다)');
}
for (const [id, name] of Object.entries(C.TITLES)) {
  add(`Title.${id}`, name, '칭호 (닉네임 옆에 붙는다, 짧게)');
}
add('Nick.Format', '{0}{1}', '닉네임 = {0} 형용사 + {1} 동물. 띄어쓰기·순서는 언어에 맞게 (예: 영어 {0}{1} → BraveCat)');
C.NICKNAME_ADJECTIVES.forEach((w, n) => add(`Nick.Adj.${String(n).padStart(2, '0')}`, w, '닉네임 형용사 (동물 앞에 붙는다, 짧게). 번호 순서를 바꾸지 않는다'));
C.NICKNAME_NOUNS.forEach((w, n) => add(`Nick.Noun.${String(n).padStart(2, '0')}`, w, '닉네임 동물 (짧게). 번호 순서를 바꾸지 않는다'));

const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const csv = '\ufeff' + ['Key,SourceString,Comment', ...rows.map((r) => r.map(q).join(','))].join('\r\n') + '\r\n';
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, csv, 'utf8');
console.log(`wrote ${rows.length} rows -> ${OUT}`);
