// ========================================
// difficulty-quiz-data.mjs - 난이도 모드 문제 · 문제 묶음 (2026-11-17, difficulty.ts)
//   사용자: "난이도 모드를 만든다. 쉬움 보통 어려움 매우 어려움
//            쉬움 : 11~19 * 1~9 / 보통 : 11~19 * 11~19 / 어려움 : 11~19 * 2~3 (표시는 22 ~ 57 로) * 11~19
//            매우 어려움 : 11~19 * 2~3(표시는 22 ~ 57 로) *11 ~ 19 * 2~3(표시는 22 ~ 57 로)"
//   단(11~19)마다 네 묶음. S3 (StartQuizSession 의 QUIZ_BUCKET_NAME) quiz/Quiz_0.json, question/Question_0.json 에 더한다.
//     문제: 어려움 297~449 ("X*b", X = 단×2 · 단×3 의 17가지 수 22~57, b = 11~19, 점수 20)
//           매우 어려움 450~738 ("X*Y", X · Y 모두 그 17가지 수, 점수 30). 쉬움 · 보통은 있는 곱셈 문제(0~170)를 그대로 씀.
//     묶음: 쉬움 211~219 · 보통 311~319 (9문제), 어려움 411~419 (18문제), 매우 어려움 511~519 (34개 중 QuizSize 18)
//   node difficulty-quiz-data.mjs pull       → 현재 두 파일을 difficulty-data/before-<시각>/ 에 받아 둔다
//   node difficulty-quiz-data.mjs build      → 가장 최근 before 에 새 항목을 더한 파일을 difficulty-data/after/ 에 만든다
//   node difficulty-quiz-data.mjs client <out.json> → 클라이언트 DT_QuestionData 에 넣을 새 문제 목록 (id · 식 · 답 길이)
//   node difficulty-quiz-data.mjs push       → after/ 를 올리고 다시 받아 확인 (운영 데이터 변경: 사용자 확인 뒤에만)
//   node difficulty-quiz-data.mjs rollback   → 가장 최근 before 를 다시 올린다
// ========================================
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROFILE = 'inchul';
const REGION = 'ap-northeast-2';
const KEYS = { quiz: 'quiz/Quiz_0.json', question: 'question/Question_0.json' };
const DIR = resolve('difficulty-data');
const FIRST_QUESTION_ID = 297; // 분수(171~296) 다음
const VERY_HARD_SIZE = 18;
const SET_BASE = { easy: 200, normal: 300, hard: 400, veryhard: 500 }; // difficulty.ts 와 같게
const SCORE = { hard: 20, veryhard: 30 };

function aws(args, json = true) {
  const cmd = `aws ${args} --profile ${PROFILE} --region ${REGION}${json ? ' --output json' : ''}`;
  console.log(`$ ${cmd}`);
  const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return json && out.trim() ? JSON.parse(out) : out;
}
function bucket() {
  const env = aws(`lambda get-function-configuration --function-name StartQuizSession --query Environment.Variables`);
  if (!env || !env.QUIZ_BUCKET_NAME) throw new Error('QUIZ_BUCKET_NAME 없음');
  return env.QUIZ_BUCKET_NAME;
}
const posix = (p) => p.replace(/\\/g, '/');
function latestBefore() {
  const ds = existsSync(DIR) ? readdirSync(DIR).filter((d) => d.startsWith('before-')).sort() : [];
  if (!ds.length) throw new Error('먼저 pull');
  return join(DIR, ds[ds.length - 1]);
}

// 단×2 · 단×3 (11~19단) → 22~57 의 17가지 수 (36 = 18×2 = 12×3 은 하나)
const XS = [...new Set([11, 12, 13, 14, 15, 16, 17, 18, 19].flatMap((d) => [d * 2, d * 3]))].sort((a, b) => a - b);

export function newItems() {
  const out = [];
  let id = FIRST_QUESTION_ID;
  for (const x of XS) for (let b = 11; b <= 19; b++) out.push({ id: String(id++), kind: 'hard', a: x, b, expr: `${x}*${b}`, answer: x * b });
  for (const x of XS) for (const y of XS) out.push({ id: String(id++), kind: 'veryhard', a: x, b: y, expr: `${x}*${y}`, answer: x * y });
  return out;
}

// 단 d 의 네 묶음: { setId: { ids, size? } } — 쉬움 · 보통은 있는 문제를 식으로 찾음
function setsFor(d, qs, items) {
  const byExpr = new Map();
  for (const [id, q] of Object.entries(qs)) if (q && typeof q.Expression === 'string') byExpr.set(q.Expression, id);
  for (const it of items) byExpr.set(it.expr, it.id);
  const find = (expr) => {
    const id = byExpr.get(expr);
    if (!id) throw new Error(`문제 ${expr} 를 못 찾음`);
    return id;
  };
  const n = d - 10;
  const xs = [d * 2, d * 3];
  return {
    [String(SET_BASE.easy + 10 + n)]: { ids: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => find(`${d}*${m}`)) },
    [String(SET_BASE.normal + 10 + n)]: { ids: [11, 12, 13, 14, 15, 16, 17, 18, 19].map((m) => find(`${d}*${m}`)) },
    [String(SET_BASE.hard + 10 + n)]: { ids: xs.flatMap((x) => [11, 12, 13, 14, 15, 16, 17, 18, 19].map((b) => find(`${x}*${b}`))) },
    [String(SET_BASE.veryhard + 10 + n)]: { ids: xs.flatMap((x) => XS.map((y) => find(`${x}*${y}`))), size: VERY_HARD_SIZE },
  };
}

const step = process.argv[2];
if (step === 'pull') {
  const b = bucket();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(DIR, `before-${stamp}`);
  mkdirSync(dir, { recursive: true });
  for (const [k, key] of Object.entries(KEYS)) aws(`s3 cp s3://${b}/${key} "${posix(join(dir, `${k}.json`))}" --only-show-errors`, false);
  writeFileSync(join(dir, 'bucket.txt'), b);
  const quiz = JSON.parse(readFileSync(join(dir, 'quiz.json'), 'utf8'));
  const qs = JSON.parse(readFileSync(join(dir, 'question.json'), 'utf8'));
  console.log('bucket', b, '| quizzes', Object.keys(quiz).join(','), '| questions', Object.keys(qs).length);
} else if (step === 'build') {
  const src = latestBefore();
  const quiz = JSON.parse(readFileSync(join(src, 'quiz.json'), 'utf8'));
  const qs = JSON.parse(readFileSync(join(src, 'question.json'), 'utf8'));
  const qTemplate = qs['0'];
  const quizTemplate = quiz['1'];
  if (!qTemplate || !quizTemplate) throw new Error('견본 항목(quiz 1, question 0)이 없음');
  const items = newItems();
  for (const it of items) {
    const q = JSON.parse(JSON.stringify(qTemplate));
    q.Expression = it.expr;
    q.ExpectedAnswer = it.answer; // 곱셈 문제는 숫자 (견본과 같게)
    q.Score = SCORE[it.kind];
    if (qs[it.id] && JSON.stringify(qs[it.id]) !== JSON.stringify(q)) throw new Error(`question ${it.id} 가 다른 내용으로 이미 있음: ${JSON.stringify(qs[it.id])}`);
    qs[it.id] = q;
  }
  let sets = 0;
  for (let d = 11; d <= 19; d++) {
    for (const [id, s] of Object.entries(setsFor(d, qs, items))) {
      const z = JSON.parse(JSON.stringify(quizTemplate));
      z.QuizID = Number(id);
      z.QuestionIDs = s.ids;
      if (s.size) z.QuizSize = s.size;
      else delete z.QuizSize;
      if (quiz[id] && JSON.stringify(quiz[id]) !== JSON.stringify(z)) throw new Error(`quiz ${id} 가 다른 내용으로 이미 있음`);
      quiz[id] = z;
      sets++;
    }
  }
  const out = join(DIR, 'after');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'quiz.json'), JSON.stringify(quiz, null, 2));
  writeFileSync(join(out, 'question.json'), JSON.stringify(qs, null, 2));
  writeFileSync(join(out, 'source.txt'), src);
  console.log('built from', src, '| new questions', items.length, `(${items[0].id}~${items[items.length - 1].id})`, '| sets', sets);
  for (const id of ['218', '318', '418', '518']) console.log(`quiz["${id}"] =`, JSON.stringify(quiz[id]).slice(0, 220));
  for (const id of ['297', '449', '450', '738']) console.log(`question["${id}"] =`, JSON.stringify(qs[id]));
} else if (step === 'client') {
  const outFile = process.argv[3] || 'difficulty-data/client_questions.json';
  const rows = newItems().map((it) => ({ id: it.id, expression: it.expr, length: String(it.answer).length }));
  writeFileSync(outFile, JSON.stringify(rows));
  console.log('client rows', rows.length, '→', outFile);
} else if (step === 'push') {
  const src = readFileSync(join(DIR, 'after', 'source.txt'), 'utf8');
  const b = readFileSync(join(src, 'bucket.txt'), 'utf8').trim();
  for (const [k, key] of Object.entries(KEYS)) {
    aws(`s3 cp "${posix(join(DIR, 'after', `${k}.json`))}" s3://${b}/${key} --content-type application/json --only-show-errors`, false);
  }
  const chk = join(DIR, 'check');
  mkdirSync(chk, { recursive: true });
  for (const [k, key] of Object.entries(KEYS)) aws(`s3 cp s3://${b}/${key} "${posix(join(chk, `${k}.json`))}" --only-show-errors`, false);
  for (const k of Object.keys(KEYS)) {
    const same = JSON.stringify(JSON.parse(readFileSync(join(chk, `${k}.json`), 'utf8'))) === JSON.stringify(JSON.parse(readFileSync(join(DIR, 'after', `${k}.json`), 'utf8')));
    console.log(k, same ? '올라감 (확인)' : '다름!');
  }
} else if (step === 'rollback') {
  const src = latestBefore();
  const b = readFileSync(join(src, 'bucket.txt'), 'utf8').trim();
  for (const [k, key] of Object.entries(KEYS)) aws(`s3 cp "${posix(join(src, `${k}.json`))}" s3://${b}/${key} --content-type application/json --only-show-errors`, false);
  console.log('rolled back from', src);
} else {
  console.log('usage: node difficulty-quiz-data.mjs pull|build|client <out>|push|rollback');
}
