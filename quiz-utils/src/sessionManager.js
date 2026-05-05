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
 * 퀴즈 완료 처리 (Results 저장 및 세션 삭제)
 */
export async function finalizeQuizResult(sessionData) {
  try {
    console.log("[finalizeQuizResult] Finalizing quiz...");

    const elapsedTime = (Date.now() - sessionData.StartTime) / 1000;

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
