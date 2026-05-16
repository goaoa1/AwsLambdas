export interface ActiveSession {
  PlayerID: string;
  QuizID: string;
  QuestionIDs: string[];
  QuestionCount: number;
  CurrentQuestionIndex: number;
  RetryQuestionIDs?: string[];
  Score: number;
  StartTime: number;
  AccumulatedPlayTime: number;
  LastResumeTime: number;
  IsPaused: boolean;
  CreatedAt: string;
  UpdatedAt: string;
}

export function getActiveSession(playerID: string): Promise<ActiveSession | null>;
export function updateSession(playerID: string, updates: Partial<ActiveSession>): Promise<ActiveSession>;
export function deleteSession(playerID: string): Promise<void>;
export function pauseSession(playerID: string): Promise<ActiveSession>;
export function resumeSession(playerID: string): Promise<ActiveSession>;
export function finalizeQuizResult(sessionData: ActiveSession): Promise<{ Status: string; Session: ActiveSession }>;
