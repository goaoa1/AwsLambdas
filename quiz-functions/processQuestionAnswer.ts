// ========================================
// processQuestionAnswer.ts - POST /process-question-answer { PlayerAnswer }
//   2026-11-08: 저장소에 소스가 없어서 배포된 코드(dist-device/originals/ProcessQuestionAnswer.zip)를 옮겨 왔고,
//   채점 뒤에 캐릭터 스킬 배율(characterSkills.ts)을 적용한다.
//   - 세션의 CharacterId(퀴즈 시작 때 적음)와 Streak(연속 정답 수)로 배율을 정한다.
//   - Result.Score 는 배율 적용 뒤 점수. Result 에 BaseScore / Multiplier / Bonus / SkillId / SkillTriggered / Streak 추가.
//   - 세션에 Streak 와 SkillBonus(이 판 스킬로 더 받은 점수 합)를 저장 → 끝나면 QuizResults 에도 남는다.
//   2026-11-09: 채점마다 PlayerQuestionStats 에 문제별 푼 횟수·맞힌 횟수를 더한다 (questionStats.ts, 빌드·배포는 *-question-stats.mjs)
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { gradeUserAnswer, processQuizStep } from 'quiz-utils/gradingManager';
import { getActiveSession, updateSession, finalizeQuizResult } from 'quiz-utils/sessionManager';
import { applySkill } from './characterSkills';
import { recordAnswer } from './questionStats';
import type { ActiveSession } from 'quiz-utils/sessionManager';

// 캐릭터 스킬로 세션에 더한 필드
type SkillSession = ActiveSession & {
  CharacterId?: string; Streak?: number; SkillBonus?: number; ElapsedTime?: number;
  // 도전과제용 한 판 기록 (QuizResults 에 남는다): 틀린 횟수, 행운 터진 횟수, 집중력 최고 배율 도달 여부
  WrongCount?: number; LuckyHits?: number; FocusMaxHit?: boolean;
};

const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('[ProcessQuestionAnswer] Lambda invoked');

    const claims = event.requestContext?.authorizer?.claims;
    if (!claims || !claims.sub) {
      return { statusCode: 401, body: JSON.stringify({ Message: 'Unauthorized' }) };
    }
    const playerID = claims.sub as string;

    if (!event.body) {
      return { statusCode: 400, body: JSON.stringify({ Message: 'No request body' }) };
    }
    const body = JSON.parse(event.body);
    const userAnswer = body.PlayerAnswer;
    if (userAnswer === undefined || userAnswer === null) {
      return { statusCode: 400, body: JSON.stringify({ Message: 'Answer is required' }) };
    }

    const session = (await getActiveSession(playerID)) as SkillSession | null;
    if (!session) {
      return { statusCode: 400, body: JSON.stringify({ Message: 'No active session' }) };
    }

    const currentQuestionIndex = session.CurrentQuestionIndex || 0;
    const questionIDs = session.QuestionIDs || [];
    const retryQuestionIDs = session.RetryQuestionIDs || [];

    // 이미 다 풀었으면 결과만 정리 (예전 동작 그대로)
    if (currentQuestionIndex >= questionIDs.length && retryQuestionIDs.length === 0) {
      const finalResult = (await finalizeQuizResult(session)) as { Status: string; Session: SkillSession };
      return json(200, {
        Success: true,
        Status: 'COMPLETED',
        bIsComplete: true,
        Session: {
          QuizID: finalResult.Session.QuizID,
          Score: finalResult.Session.Score,
          ElapsedTime: finalResult.Session.ElapsedTime,
        },
      });
    }

    const bIsRetryPhase = currentQuestionIndex >= questionIDs.length && retryQuestionIDs.length > 0;
    const currentQuestionID = bIsRetryPhase ? retryQuestionIDs[0] : questionIDs[currentQuestionIndex];

    // 채점 → 캐릭터 스킬 배율
    const gradingResult = await gradeUserAnswer(currentQuestionID, userAnswer);
    const skill = applySkill(session.CharacterId, gradingResult.bIsCorrect, gradingResult.Score, {
      Streak: session.Streak ?? 0,
    });
    const scoredResult = {
      ...gradingResult,
      Score: skill.Score,
      BaseScore: skill.BaseScore,
      Multiplier: skill.Multiplier,
      Bonus: skill.Bonus,
      SkillId: skill.SkillId,
      SkillTriggered: skill.SkillTriggered,
      Streak: skill.Streak,
    };
    // 연속 정답 수와 스킬 보너스 합을 먼저 세션에 적는다 (processQuizStep 이 세션을 다시 읽어 점수·진행을 더한다)
    await updateSession(playerID, {
      Streak: skill.Streak,
      SkillBonus: (session.SkillBonus ?? 0) + skill.Bonus,
      WrongCount: (session.WrongCount ?? 0) + (gradingResult.bIsCorrect ? 0 : 1),
      LuckyHits: (session.LuckyHits ?? 0) + (skill.SkillId === 'Lucky' && skill.SkillTriggered ? 1 : 0),
      FocusMaxHit: !!session.FocusMaxHit || (skill.SkillId === 'Focus' && skill.SkillTriggered),
    } as Partial<SkillSession>);
    console.log(
      `[ProcessQuestionAnswer] ${playerID} q=${currentQuestionID} correct=${gradingResult.bIsCorrect} ` +
        `skill=${skill.SkillId} x${skill.Multiplier} ${skill.BaseScore}->${skill.Score} streak=${skill.Streak}`
    );

    // 문제별 정답률 (2026-11-09, 커리어 "정답률" 탭): 답할 때마다 푼 횟수·맞힌 횟수를 센다. 실패해도 채점은 계속
    try {
      await recordAnswer(playerID, String(currentQuestionID), !!gradingResult.bIsCorrect);
    } catch (e) {
      console.error('[ProcessQuestionAnswer] question stats update failed:', e);
    }

    const processResult = await processQuizStep(scoredResult, playerID);
    const updatedSession = processResult.Session;
    return json(200, {
      Success: true,
      Status: processResult.Status,
      Result: scoredResult,
      Session: {
        QuestionCount: updatedSession.QuestionIDs.length,
        ...updatedSession,
      },
    });
  } catch (error) {
    console.error('[Lambda Error]:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ Success: false, Message: (error as Error).message }),
    };
  }
};
