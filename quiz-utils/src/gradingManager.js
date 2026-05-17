// ========================================
// layers/quiz-utils/nodejs/node_modules/quiz-utils/gradingManager.js
// ========================================
import { getQuestionData } from './questionManager.js';
import { getActiveSession, updateSession, finalizeQuizResult } from './sessionManager.js';

/**
 * 4. 퀴즈 진행 업데이트 (인덱스 및 재시도 큐 관리)
 */
export async function updateQuizProgress(
  sessionData,
  gradingResult,
  bIsRetryPhase
) {
  const { bIsCorrect, Score: addedScore, QuestionID } = gradingResult;
  const {
    PlayerID: playerID,
    CurrentQuestionIndex: currentIndex,
    Score: score,
    RetryQuestionIDs = [],
  } = sessionData;

  // DB 업데이트용 객체 (PascalCase 필드명 사용)
  let updates = {
    Score: score + addedScore,
  };

  if (bIsRetryPhase) {
    if (bIsCorrect) {
      // 정답: 큐에서 제거
      const newRetryIDs = RetryQuestionIDs.slice(1);
      updates.RetryQuestionIDs = newRetryIDs;
    } else {
      // 오답: 큐 뒤로 이동
      const newRetryIDs = [...RetryQuestionIDs.slice(1), RetryQuestionIDs[0]];
      updates.RetryQuestionIDs = newRetryIDs;
    }
  } else {// 일반 페이즈:
    if (bIsCorrect){//정답인 경우에만 인덱스 증가(틀리면 다시 풀어야 한다.)
    updates.CurrentQuestionIndex = currentIndex + 1;}
    else{
      // 오답인 경우에만 큐에 추가
      updates.RetryQuestionIDs = [...RetryQuestionIDs, QuestionID];
    }
  }

  const updatedSession = await updateSession(playerID, updates);
  return updatedSession;
}

/**
 * 5. 퀴즈 단계 처리 (메인 진입점)
 */
export async function processQuizStep(gradingResult, playerID) {
  const session = await getActiveSession(playerID);

  if (!session) {
    throw new Error("No active session found");
  }

  const {
    QuestionIDs = [],
    CurrentQuestionIndex = 0,
    RetryQuestionIDs = [],
  } = session;

  // 아직 종료 전이면 진행 업데이트
  // 현재 문제가 재시도 페이즈인지 판단 로직 : 모든 문제를 다 풀었고, 쌓아둔 RetryQuestionIDs 이 존재하면 bIsRetryPhase 이다.
  const bIsRetryPhase = CurrentQuestionIndex >= QuestionIDs.length && RetryQuestionIDs.length >= 1;
  const updatedSession = await updateQuizProgress(session, gradingResult, bIsRetryPhase);

  // 종료 조건 판단
  const bIsAllQuestionsAnswered = updatedSession.CurrentQuestionIndex >= updatedSession.QuestionIDs.length;
  const bIsRetryQueueEmpty = updatedSession.RetryQuestionIDs.length === 0;
  const bIsQuizComplete = bIsAllQuestionsAnswered && bIsRetryQueueEmpty;

  // 최종 결과 객체 생성
  let result;
  if (bIsQuizComplete) {
    // 종료 시: DB 정리 및 결과 객체 생성 (이미 { Status, Session } 구조임)
    result = await finalizeQuizResult(updatedSession);
  } else {
    // 진행 중 시: AccumulatedPlayTime 은 pauseSession 호출 시에만 DB에 누적되므로
    // 일시정지 없이 풀고 있는 동안에는 DB 값이 0(또는 마지막 누적값)에 머문다.
    // getQuizSession.ts / finalizeQuizResult 와 동일하게 응답 시점에 라이브 값으로 보정.
    const accumulated = updatedSession.AccumulatedPlayTime ?? 0;
    const liveAccumulatedPlayTime = updatedSession.IsPaused
      ? accumulated
      : accumulated + (Date.now() - updatedSession.LastResumeTime) / 1000;
    result = {
      Status: "CONTINUE",
      Session: {
        ...updatedSession,
        AccumulatedPlayTime: liveAccumulatedPlayTime,
      },
    };
  }

  return result;
}

/**
 * 단일 문제 채점
 */
export async function gradeUserAnswer(questionID, userAnswer) {
  try {
    const questionData = await getQuestionData(questionID);
    const answerData = String(questionData.ExpectedAnswer);

    if (!userAnswer || userAnswer.trim() === '') {
      return {
        QuestionID: questionID,
        bIsCorrect: false,
        Score: 0,
        CorrectAnswer: answerData,
      };
    }

    const isCorrect = normalizeAnswer(answerData) === normalizeAnswer(userAnswer);

    // Unreal 구조체에 맞춘 리턴 객체 (PascalCase)
    return {
      QuestionID: questionID,
      bIsCorrect: isCorrect,
      Score: isCorrect ? questionData.Score : 0,
      CorrectAnswer: answerData,
    };
  } catch (error) {
    console.error(`Grading failed for ${questionID}:`, error);
    throw error;
  }
}

function normalizeAnswer(answer) {
  return answer.toString().trim().toLowerCase();
}
