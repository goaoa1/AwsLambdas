export interface QuizData {
  QuestionIDs: string[];
  [key: string]: unknown;
}

export interface ShuffledQuizData extends QuizData {
  OriginalOrder: string[];
}

export function getQuizData(quizID: string, bUseCache?: boolean): Promise<QuizData>;
export function getShuffledQuestionIDs(quizID: string): Promise<ShuffledQuizData>;
