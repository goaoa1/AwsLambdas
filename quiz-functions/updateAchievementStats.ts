// ========================================
// updateAchievementStats.ts - QuizResults 스트림 → PlayerStats (도전과제 진행도)
//   UpdateBestRecords 와 같은 스트림을 따로 구독한다. 새 결과(INSERT)마다 addFinishedQuiz.
//   같은 기록을 다시 받아도 LastResultTs 조건으로 두 번 세지 않는다.
// ========================================
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { addFinishedQuiz, type FinishedQuiz } from './achievementStats';

export const handler = async (event: DynamoDBStreamEvent) => {
  let applied = 0;
  for (const rec of event.Records ?? []) {
    if (rec.eventName !== 'INSERT' || !rec.dynamodb?.NewImage) continue;
    const r = unmarshall(rec.dynamodb.NewImage as never) as Record<string, unknown>;
    if (!r.PlayerID || r.Timestamp == null) continue;
    const quiz: FinishedQuiz = {
      PlayerID: String(r.PlayerID),
      Timestamp: Number(r.Timestamp),
      QuizID: r.QuizID != null ? String(r.QuizID) : undefined,
      QuestionCount: Number(r.QuestionCount) || (Array.isArray(r.QuestionIDs) ? r.QuestionIDs.length : 0),
      ElapsedTime: Number(r.ElapsedTime) || undefined,
      CharacterId: typeof r.CharacterId === 'string' ? r.CharacterId : undefined,
      WrongCount: typeof r.WrongCount === 'number' ? r.WrongCount : undefined,
      LuckyHits: Number(r.LuckyHits) || 0,
      FocusMaxHit: r.FocusMaxHit === true,
    };
    if (await addFinishedQuiz(quiz)) applied++;
  }
  console.log(`[UpdateAchievementStats] records=${event.Records?.length ?? 0} applied=${applied}`);
};
