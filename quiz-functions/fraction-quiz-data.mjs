// ========================================
// fraction-quiz-data.mjs - 분수 → 소수 퀴즈 데이터 (2026-11-09)
//   사용자: "1/11~10/11 … 1/19~18/19 를 공부할 퀴즈 세트, 답은 소수 셋째 자리까지" → 버림, 분모별 9세트
//   S3 (StartQuizSession 의 QUIZ_BUCKET_NAME) 의 quiz/Quiz_0.json, question/Question_0.json 에
//     퀴즈 111~119 (100 + 분모) 와 문제 171~296 (분모 11→19, 분자 1→d-1) 을 더한다. Lambda 코드는 그대로.
//   문제: Expression "n/d", ExpectedAnswer = 소수점 아래 세 자리 숫자열 (버림, 1/11 → "090").
//         클라이언트는 답 줄 앞에 "0." 을 붙여 보이고, 카드 세 장만 받는다 (DT_QuestionData 171~296, 답 길이 3).
//   node fraction-quiz-data.mjs pull       → 현재 두 파일을 fraction-data/before-<시각>/ 에 받아 둔다
//   node fraction-quiz-data.mjs build      → 가장 최근 before 에 새 항목을 더한 파일을 fraction-data/after/ 에 만든다 (기존 항목 모양을 그대로 따라 함)
//   node fraction-quiz-data.mjs push       → after/ 를 올리고 다시 받아 확인 (운영 데이터 변경: 사용자 확인 뒤에만)
//   node fraction-quiz-data.mjs rollback   → 가장 최근 before 를 다시 올린다
// ========================================
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROFILE = 'inchul';
const REGION = 'ap-northeast-2';
const KEYS = { quiz: 'quiz/Quiz_0.json', question: 'question/Question_0.json' };
const DIR = resolve('fraction-data');
const FIRST_QUESTION_ID = 171;

function aws(args, json = true) {
  const cmd = `aws ${args} --profile ${PROFILE} --region ${REGION}${json ? ' --output json' : ''}`;
  console.log(`$ ${cmd}`);
  const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return json && out.trim() ? JSON.parse(out) : out;
}
function bucket() {
  const fns = aws(`lambda list-functions --query "Functions[?FunctionName=='StartQuizSession'].FunctionName"`);
  if (!fns.length) throw new Error('StartQuizSession 함수를 못 찾음');
  const env = aws(`lambda get-function-configuration --function-name StartQuizSession --query Environment.Variables`);
  if (!env.QUIZ_BUCKET_NAME) throw new Error('QUIZ_BUCKET_NAME 없음');
  return env.QUIZ_BUCKET_NAME;
}
const posix = (p) => p.replace(/\\/g, '/');
function latestBefore() {
  const ds = existsSync(DIR) ? readdirSync(DIR).filter((d) => d.startsWith('before-')).sort() : [];
  if (!ds.length) throw new Error('먼저 pull');
  return join(DIR, ds[ds.length - 1]);
}

function fractionItems() {
  const out = [];
  let id = FIRST_QUESTION_ID;
  for (let d = 11; d <= 19; d++) {
    for (let n = 1; n < d; n++) {
      out.push({ id: String(id++), d, n, expr: `${n}/${d}`, answer: String(Math.floor((n * 1000) / d)).padStart(3, '0') });
    }
  }
  return out;
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
  console.log('quiz["1"] =', JSON.stringify(quiz['1']).slice(0, 400));
  console.log('question["0"] =', JSON.stringify(qs['0']), '| question["170"] =', JSON.stringify(qs['170']));
} else if (step === 'build') {
  const src = latestBefore();
  const quiz = JSON.parse(readFileSync(join(src, 'quiz.json'), 'utf8'));
  const qs = JSON.parse(readFileSync(join(src, 'question.json'), 'utf8'));
  const qTemplate = qs['0'];
  const quizTemplate = quiz['1'];
  if (!qTemplate || !quizTemplate) throw new Error('견본 항목(quiz 1, question 0)이 없음');
  const items = fractionItems();
  const clash = items.filter((it) => qs[it.id]).map((it) => it.id);
  const quizClash = Array.from({ length: 9 }, (_, i) => String(111 + i)).filter((id) => quiz[id]);
  if (clash.length || quizClash.length) {
    console.log('이미 있는 ID:', clash.join(','), quizClash.join(','), '— 같은 내용이면 덮어쓰고, 아니면 멈춘다');
  }
  for (const it of items) {
    const q = JSON.parse(JSON.stringify(qTemplate));
    for (const k of Object.keys(q)) {
      if (k === 'Expression') q[k] = it.expr;
      else if (k === 'ExpectedAnswer') q[k] = it.answer;            // 문자열로 (앞의 0 유지)
      else if (k === 'QuestionID') q[k] = it.id;
      else if (k === 'ExpectedAnswerLength' || k === 'AnswerLength') q[k] = 3;
      else if (Array.isArray(q[k]) && k.toLowerCase().includes('answer')) q[k] = it.answer.split('');
    }
    if (!('Expression' in q)) q.Expression = it.expr;
    if (!('ExpectedAnswer' in q)) q.ExpectedAnswer = it.answer;
    if (qs[it.id] && JSON.stringify(qs[it.id]) !== JSON.stringify(q)) throw new Error(`question ${it.id} 가 다른 내용으로 이미 있음`);
    qs[it.id] = q;
  }
  for (let d = 11; d <= 19; d++) {
    const id = String(100 + d);
    const z = JSON.parse(JSON.stringify(quizTemplate));
    const ids = items.filter((it) => it.d === d).map((it) => it.id);
    for (const k of Object.keys(z)) {
      if (k === 'QuestionIDs') z[k] = ids;
      else if (k === 'QuizSize' || k === 'QuestionCount') z[k] = ids.length;
      else if (k === 'QuizID') z[k] = typeof z[k] === 'number' ? Number(id) : id;   // 기존 항목은 숫자 (1~9)
      else if (typeof z[k] === 'string' && /11\s*[x×*]\s*11|11단/.test(z[k])) z[k] = `÷${d}`;
    }
    if (!('QuestionIDs' in z)) z.QuestionIDs = ids;
    if (quiz[id] && JSON.stringify(quiz[id]) !== JSON.stringify(z)) throw new Error(`quiz ${id} 가 다른 내용으로 이미 있음`);
    quiz[id] = z;
  }
  const out = join(DIR, 'after');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'quiz.json'), JSON.stringify(quiz, null, 2));
  writeFileSync(join(out, 'question.json'), JSON.stringify(qs, null, 2));
  writeFileSync(join(out, 'source.txt'), src);
  console.log('built from', src);
  console.log('quiz["111"] =', JSON.stringify(quiz['111']));
  console.log('question 171/180/181/296 =', ['171', '180', '181', '296'].map((k) => JSON.stringify(qs[k])).join(' | '));
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
  console.log('usage: node fraction-quiz-data.mjs pull|build|push|rollback');
}
