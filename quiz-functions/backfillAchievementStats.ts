// ========================================
// backfillAchievementStats.ts - 지금까지의 QuizResults 를 PlayerStats 에 한 번 채워 넣는다 (도전과제 1단계)
//   build-achievements.mjs 가 dist-achievements/backfill.cjs 로 묶는다.
//   실행: set AWS_PROFILE=inchul & set REGION=ap-northeast-2 & node dist-achievements/backfill.cjs [--dry]
//   스트림 소비자와 같은 addFinishedQuiz 를 시간 순서대로 부르므로, 이미 반영된 기록(LastResultTs 이하)은 건너뛴다.
//   예전 결과에는 WrongCount·CharacterId·LuckyHits 가 없어서 완벽한 퀴즈·캐릭터·스킬 기록은 채워지지 않는다.
// ========================================
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { addFinishedQuiz, type FinishedQuiz } from './achievementStats';

const DRY = process.argv.includes('--dry');
const client = new DynamoDBClient({ region: process.env.REGION || 'ap-northeast-2' });

async function main() {
  const byPlayer = new Map<string, FinishedQuiz[]>();
  let start: Record<string, unknown> | undefined;
  let total = 0;
  do {
    const r = await client.send(
      new ScanCommand({
        TableName: 'QuizResults',
        ProjectionExpression: 'PlayerID, #ts, QuizID, QuestionCount, QuestionIDs, ElapsedTime, CharacterId, WrongCount, LuckyHits, FocusMaxHit',
        ExpressionAttributeNames: { '#ts': 'Timestamp' },
        ExclusiveStartKey: start as never,
      })
    );
    for (const it of r.Items ?? []) {
      const x = unmarshall(it) as Record<string, unknown>;
      if (!x.PlayerID || x.Timestamp == null) continue;
      total++;
      const q: FinishedQuiz = {
        PlayerID: String(x.PlayerID),
        Timestamp: Number(x.Timestamp),
        QuizID: x.QuizID != null ? String(x.QuizID) : undefined,
        QuestionCount: Number(x.QuestionCount) || (Array.isArray(x.QuestionIDs) ? x.QuestionIDs.length : 0),
        ElapsedTime: Number(x.ElapsedTime) || undefined,
        CharacterId: typeof x.CharacterId === 'string' ? x.CharacterId : undefined,
        WrongCount: typeof x.WrongCount === 'number' ? x.WrongCount : undefined,
        LuckyHits: Number(x.LuckyHits) || 0,
        FocusMaxHit: x.FocusMaxHit === true,
      };
      if (!byPlayer.has(q.PlayerID)) byPlayer.set(q.PlayerID, []);
      byPlayer.get(q.PlayerID)!.push(q);
    }
    start = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (start);

  console.log(`results=${total} players=${byPlayer.size}${DRY ? ' (dry)' : ''}`);
  for (const [player, list] of byPlayer) {
    list.sort((a, b) => a.Timestamp - b.Timestamp);
    let applied = 0;
    if (!DRY) for (const q of list) if (await addFinishedQuiz(q)) applied++;
    const quizzes = new Set(list.map((q) => q.QuizID)).size;
    console.log(`  ${player}: results=${list.length} distinctQuiz=${quizzes} applied=${DRY ? '-' : applied}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
