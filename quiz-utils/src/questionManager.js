// ========================================
// layers/quiz-utils/nodejs/node_modules/quiz-utils/questionManager.js
// ========================================

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({ region: process.env.REGION });
const QUIZ_BUCKET_NAME = process.env.QUIZ_BUCKET_NAME;

// 캐시 (Lambda 재사용 시 유지)
const quizCache = new Map();
const questionCache = new Map();

/**
 * QuizID와 인덱스로 QuestionID 조회
 */
export async function getQuestionID(quizID, questionIndex) {
  try {
    let quizData;

    if (quizCache.has(quizID)) {
      quizData = quizCache.get(quizID);
      console.log(`[Cache Hit] Quiz: ${quizID}`);
    } else {
      console.log(`[S3 Fetch] Quiz: ${quizID}`);
      const command = new GetObjectCommand({
        Bucket: QUIZ_BUCKET_NAME,
        Key: `quiz/Quiz_0.json`, // S3 경로 규칙
      });

      const response = await s3Client.send(command);
      const bodyString = await response.Body.transformToString();
      const allQuizData = JSON.parse(bodyString);

      // S3 JSON의 루트 키가 QuizID인 경우 추출
      quizData = allQuizData[quizID];

      if (!quizData) {
        throw new Error(`Quiz ${quizID} not found in S3 JSON`);
      }

      quizCache.set(quizID, quizData);
    }

    // S3 필드는 PascalCase (QuestionIDs)
    const questionIDs = quizData.QuestionIDs;

    if (!questionIDs || !Array.isArray(questionIDs)) {
      throw new Error(`Invalid QuestionIDs structure for quiz ${quizID}`);
    }

    if (questionIndex < 0 || questionIndex >= questionIDs.length) {
      throw new Error(
        `Question index ${questionIndex} out of range for quiz ${quizID}`
      );
    }

    return questionIDs[questionIndex];
  } catch (error) {
    console.error(`[getQuestionID] Error:`, error);
    throw error;
  }
}

/**
 * S3에서 Question 데이터 가져오기 (JSON)
 */
async function loadQuestionFromJSON(questionID) {
  console.log(`[S3 Fetch] Question JSON for ID: ${questionID}`);

  const command = new GetObjectCommand({
    Bucket: QUIZ_BUCKET_NAME,
    Key: `question/Question_0.json`,
  });

  const response = await s3Client.send(command);
  const bodyString = await response.Body.transformToString();
  return JSON.parse(bodyString);
}

/**
 * Question 데이터 로드 (캐싱 포함)
 */
export async function getQuestionData(questionID, bUseCache = true) {
  if (bUseCache && questionCache.has(questionID)) {
    console.log(`[Cache Hit] Question: ${questionID}`);
    return questionCache.get(questionID);
  }

  try {
    const allQuestionData = await loadQuestionFromJSON(questionID);

    // 해당 questionID 추출
    const targetQuestion = allQuestionData[questionID];

    if (!targetQuestion) {
      throw new Error(`Question ${questionID} not found in JSON`);
    }

    if (bUseCache) {
      questionCache.set(questionID, targetQuestion);
    }

    // 반환되는 객체의 필드는 S3 원본 그대로 PascalCase (Expression, CorrectAnswers 등)
    return targetQuestion;
  } catch (error) {
    console.error('[getQuestionData] Error:', error);
    throw error;
  }
}
