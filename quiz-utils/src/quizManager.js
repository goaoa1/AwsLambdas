// ========================================
// layers/quiz-utils/nodejs/node_modules/quiz-utils/quizManager.js
// ========================================

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({ region: process.env.REGION });
const QUIZ_BUCKET_NAME = process.env.QUIZ_BUCKET_NAME;

// 캐시 (메모리 내 보관)
const quizCache = new Map();

/**
 * Fisher-Yates 셔플 알고리즘
 */
function shuffleArray(array) {
  const shuffled = [...array];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * S3에서 Quiz 데이터 가져오기 (JSON)
 * S3 내 JSON 파일의 Key 구조는 PascalCase를 따름
 */
async function loadQuizFromJSON(quizID) {
  console.log(`[S3 Fetch] Quiz JSON for ID: ${quizID}`);

  const command = new GetObjectCommand({
    Bucket: QUIZ_BUCKET_NAME,
    Key: `quiz/Quiz_0.json`, // 파일 경로는 관례에 따름
  });

  const response = await s3Client.send(command);
  const bodyString = await response.Body.transformToString();
  return JSON.parse(bodyString);
}

/**
 * Quiz 데이터 로드 (캐싱 포함)
 */
export async function getQuizData(quizID, bUseCache = true) {
  if (bUseCache && quizCache.has(quizID)) {
    console.log(`[Cache Hit] Quiz: ${quizID}`);
    return quizCache.get(quizID);
  }

  try {
    const allQuizData = await loadQuizFromJSON(quizID);

    // S3 JSON의 루트 키가 QuizID인 경우 추출
    const targetQuiz = allQuizData[quizID];

    if (!targetQuiz) {
      throw new Error(`Quiz ${quizID} not found in JSON`);
    }

    if (bUseCache) {
      quizCache.set(quizID, targetQuiz);
    }

    return targetQuiz;
  } catch (error) {
    console.error('[getQuizData] Error:', error);
    throw error;
  }
}

/**
 * Quiz의 문제 리스트를 셔플하여 반환
 * 반환되는 객체의 필드는 DB/Unreal 규격인 PascalCase 유지
 */
export async function getShuffledQuestionIDs(quizID) {
  const quizData = await getQuizData(quizID);

  // S3 필드명은 PascalCase (QuestionIDs)
  const originalIDs = quizData.QuestionIDs;

  if (!originalIDs || !Array.isArray(originalIDs)) {
    throw new Error(`Invalid QuestionIDs format for quiz ${quizID}`);
  }

  const shuffledIDs = shuffleArray(originalIDs);

  console.log(`[Quiz ${quizID}] Shuffled ${shuffledIDs.length} questions`);

  // 반환 시 스프레드 연산자를 사용하여 기존 PascalCase 필드들을 유지하고
  // 셔플된 리스트로 덮어씀
  return {
    ...quizData,
    QuestionIDs: shuffledIDs,
    OriginalOrder: originalIDs, // Unreal/DB 기록용 PascalCase
  };
}
