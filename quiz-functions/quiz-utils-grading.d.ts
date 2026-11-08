// quiz-utils/gradingManager.js 에는 타입 선언이 없어서 여기서 필요한 만큼만 적는다
declare module 'quiz-utils/gradingManager' {
  export interface GradingResult {
    QuestionID: string;
    bIsCorrect: boolean;
    Score: number;
    CorrectAnswer: string;
    [key: string]: unknown;
  }
  export function gradeUserAnswer(questionID: string, userAnswer: string): Promise<GradingResult>;
  export function processQuizStep(
    gradingResult: GradingResult,
    playerID: string
  ): Promise<{ Status: string; Session: { QuestionIDs: string[]; [key: string]: unknown } }>;
}
