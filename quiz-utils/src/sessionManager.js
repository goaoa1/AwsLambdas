// ========================================
// layers/quiz-utils/nodejs/node_modules/quiz-utils/sessionManager.js
// ========================================

import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const SESSIONS_TABLE = "ActiveQuizSessions";
const RESULTS_TABLE = "QuizResults";

/**
 * 활성 세션 조회
 */
export async function getActiveSession(playerID) {
  try {
    const getItemCommand = new GetItemCommand({
      TableName: SESSIONS_TABLE,
      // DB 파티션 키 이름은 PascalCase인 PlayerID
      Key: marshall({ PlayerID: playerID }),
    });

    const result = await dynamoDBClient.send(getItemCommand);

    if (!result.Item) {
      console.log(`[getActiveSession] No active session found for player ${playerID}`);
      return null;
    }

    // unmarshall 결과는 DB 필드명 그대로 PascalCase 객체 반환
    return unmarshall(result.Item);
  } catch (error) {
    console.error("[getActiveSession] Error:", error);
    throw error;
  }
}

/**
 * 세션 업데이트
 */
export async function updateSession(playerID, updates) {
  try {
    const session = await getActiveSession(playerID);

    if (!session) {
      throw new Error(`No active session for player ${playerID}`);
    }

    // 기존 세션(PascalCase)과 새로운 업데이트(PascalCase)를 병합
    const updatedSession = {
      RetryQuestionIDs: [],
      ...session,
      ...updates,
      UpdatedAt: new Date().toISOString(),
    };

    await dynamoDBClient.send(
      new PutItemCommand({
        TableName: SESSIONS_TABLE,
        Item: marshall(updatedSession, {
          removeUndefinedValues: true,
        }),
      })
    );

    return updatedSession;
  } catch (error) {
    console.error("[updateSession] Error:", error);
    throw error;
  }
}

/**
 * 세션 삭제
 */
export async function deleteSession(playerID) {
  try {
    await dynamoDBClient.send(
      new DeleteItemCommand({
        TableName: SESSIONS_TABLE,
        Key: marshall({ PlayerID: playerID }),
      })
    );

    console.log(`[deleteSession] Session deleted for player ${playerID}`);
  } catch (error) {
    console.error("[deleteSession] Error:", error);
    throw error;
  }
}

/**
 * 세션 일시정지 — AccumulatedPlayTime 에 경과분을 누적하고 IsPaused = true 로 전환
 */
export async function pauseSession(playerID) {
  const session = await getActiveSession(playerID);
  if (!session) {
    throw new Error(`No active session for player ${playerID}`);
  }
  if (session.IsPaused) {
    return session; // 이미 일시정지 상태면 멱등 처리
  }

  const now = Date.now();
  const additionalTime = (now - session.LastResumeTime) / 1000;
  return updateSession(playerID, {
    AccumulatedPlayTime: (session.AccumulatedPlayTime ?? 0) + additionalTime,
    IsPaused: true,
  });
}

/**
 * 세션 재개 — LastResumeTime 을 현재 시각으로 갱신하고 IsPaused = false 로 전환
 */
export async function resumeSession(playerID) {
  const session = await getActiveSession(playerID);
  if (!session) {
    throw new Error(`No active session for player ${playerID}`);
  }
  if (!session.IsPaused) {
    return session; // 이미 진행 중이면 멱등 처리
  }

  return updateSession(playerID, {
    LastResumeTime: Date.now(),
    IsPaused: false,
  });
}

/**
 * 퀴즈 완료 처리 (Results 저장 및 세션 삭제)
 */
export async function finalizeQuizResult(sessionData) {
  try {
    console.log("[finalizeQuizResult] Finalizing quiz...");

    // 일시정지 중이 아니라면 LastResumeTime 이후 경과분을 마지막으로 누적
    const pendingTime = sessionData.IsPaused
      ? 0
      : (Date.now() - sessionData.LastResumeTime) / 1000;
    const elapsedTime = (sessionData.AccumulatedPlayTime ?? 0) + pendingTime;

    // Unreal 구조체 매핑을 위해 PascalCase로 구성
    const quizResult = {
      ...sessionData,
      Timestamp: Date.now(),
      ElapsedTime: elapsedTime,
      CreatedAt: new Date().toISOString(),
    };

    await dynamoDBClient.send(
      new PutItemCommand({
        TableName: RESULTS_TABLE,
        Item: marshall(quizResult, { removeUndefinedValues: true }),
      }),
    );

    await dynamoDBClient.send(
      new DeleteItemCommand({
        TableName: SESSIONS_TABLE,
        Key: marshall({ PlayerID: sessionData.PlayerID }),
      }),
    );

    return {
      Status: "COMPLETED",
      Session: quizResult
    };
  } catch (error) {
    console.error("[finalizeQuizResult] Error:", error);
    throw error;
  }
}
