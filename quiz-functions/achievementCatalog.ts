// ========================================
// achievementCatalog.ts - 도전과제 목록 (도전과제 1단계, 2026-11-08)
//   숫자·이름·칭호를 바꿀 때는 이 파일만 고친다. 한 도전과제는 단계(Tiers)를 가지며 단계마다 보상을 따로 받는다.
//   Stat: 진행도를 어디서 읽는지 (achievementProgress.ts 의 computeStats 키)
//   Reward: Credits / Stamina(최대 10까지만) / Title(칭호 ID) / Outfit(전용 의상, 아직 준비 중 → 그 단계는 받을 수 없음)
//   LowerIsBetter: 번개 손처럼 값이 작을수록 좋은 목표 (진행도 <= Goal 이면 달성)
// ========================================

export type Category = 'Play' | 'Skill' | 'Habit' | 'Social';

export interface Reward {
  Credits?: number;
  Stamina?: number;
  Items?: Record<string, number>; // 아이템 (itemCatalog.ts). 2026-11-08: 스태미나 보상을 아이템으로 바꿈 (가득 차도 받을 수 있게)
  Title?: string;
  Outfit?: string;
}

export interface Tier {
  Goal: number;
  Reward: Reward;
}

export interface Achievement {
  Id: string;
  Category: Category;
  Name: string;
  Desc: string;      // {Goal} 자리에 단계 목표가 들어간다
  Stat: StatKey;
  Tiers: Tier[];
  LowerIsBetter?: boolean;
}

export type StatKey =
  | 'QuizzesCompleted'
  | 'ClearedQuizCount'
  | 'CorrectAnswers'
  | 'PerfectQuizzes'
  | 'BestAvgSeconds'
  | 'AttendanceStreakBest'
  | 'TotalAttendanceDays'
  | 'FriendCount'
  | 'GiftsSent'
  | 'CharactersPlayed'
  | 'LuckyHits'
  | 'FocusMaxQuizzes';

// '단 정복'에 세는 퀴즈 (QuizID 1~9 = 11×11~19×19). 0 은 예전 시험용 퀴즈라 세지 않는다
export const TABLE_QUIZ_IDS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9']);

// 칭호 (3단계에서 프로필에 표시)
export const TITLES: Record<string, string> = {
  Title_Conqueror19: '19단 정복자',
  Title_ZeroMistake: '실수 제로',
  Title_Lightning: '번개 손',
  Title_Attendance: '개근왕',
  Title_Lucky: '행운아',
  Title_Focus: '몰입의 달인',
};

// 전용 의상 (4단계에서 만듦). 여기 없는 의상 보상 단계는 '준비 중'
export const EXCLUSIVE_OUTFITS_READY = new Set<string>([]);

export const ACHIEVEMENTS: Achievement[] = [
  // ---- 플레이·클리어 ----
  {
    Id: 'QuizComplete', Category: 'Play', Name: '퀴즈 완주', Desc: '퀴즈를 {Goal}판 끝까지 풀기', Stat: 'QuizzesCompleted',
    Tiers: [
      { Goal: 1, Reward: { Credits: 20 } },
      { Goal: 10, Reward: { Credits: 50 } },
      { Goal: 30, Reward: { Credits: 100 } },
      { Goal: 100, Reward: { Credits: 200, Items: { Item_StaminaFull: 1 } } },
      { Goal: 300, Reward: { Credits: 400 } },
    ],
  },
  {
    Id: 'ClearTables', Category: 'Play', Name: '단 정복', Desc: '서로 다른 단 {Goal}개 끝내기 (11×11~19×19)', Stat: 'ClearedQuizCount',
    Tiers: [
      { Goal: 1, Reward: { Credits: 30 } },
      { Goal: 3, Reward: { Credits: 60 } },
      { Goal: 6, Reward: { Credits: 120 } },
      { Goal: 9, Reward: { Title: 'Title_Conqueror19' } },
    ],
  },
  {
    Id: 'CorrectAnswers', Category: 'Play', Name: '누적 정답', Desc: '정답 {Goal}개 맞히기', Stat: 'CorrectAnswers',
    Tiers: [
      { Goal: 100, Reward: { Credits: 30 } },
      { Goal: 500, Reward: { Credits: 100 } },
      { Goal: 2000, Reward: { Credits: 250 } },
      { Goal: 5000, Reward: { Outfit: 'Outfit_Exclusive_Scholar' } },
    ],
  },
  // ---- 실력 ----
  {
    Id: 'PerfectQuiz', Category: 'Skill', Name: '완벽한 퀴즈', Desc: '한 번도 틀리지 않고 {Goal}판 끝내기', Stat: 'PerfectQuizzes',
    Tiers: [
      { Goal: 1, Reward: { Credits: 50 } },
      { Goal: 10, Reward: { Credits: 150 } },
      { Goal: 50, Reward: { Title: 'Title_ZeroMistake' } },
    ],
  },
  {
    Id: 'Lightning', Category: 'Skill', Name: '번개 손', Desc: '문제당 평균 {Goal}초 안에 한 판 끝내기', Stat: 'BestAvgSeconds',
    LowerIsBetter: true,
    Tiers: [
      { Goal: 6, Reward: { Credits: 50 } },
      { Goal: 4, Reward: { Credits: 100 } },
      { Goal: 3, Reward: { Title: 'Title_Lightning' } },
    ],
  },
  // ---- 습관 ----
  {
    Id: 'AttendanceStreak', Category: 'Habit', Name: '연속 출석', Desc: '{Goal}일 연속 출석하기', Stat: 'AttendanceStreakBest',
    Tiers: [
      { Goal: 3, Reward: { Items: { Item_StaminaS: 3 } } },
      { Goal: 7, Reward: { Items: { Item_StaminaL: 2 } } },
      { Goal: 14, Reward: { Credits: 100 } },
      { Goal: 30, Reward: { Title: 'Title_Attendance' } },
    ],
  },
  {
    Id: 'AttendanceTotal', Category: 'Habit', Name: '누적 출석', Desc: '모두 {Goal}일 출석하기', Stat: 'TotalAttendanceDays',
    Tiers: [
      { Goal: 10, Reward: { Credits: 50 } },
      { Goal: 30, Reward: { Credits: 150 } },
      { Goal: 100, Reward: { Credits: 300 } },
    ],
  },
  // ---- 친구·캐릭터 ----
  {
    Id: 'Friends', Category: 'Social', Name: '친구 사귀기', Desc: '친구 {Goal}명 사귀기', Stat: 'FriendCount',
    Tiers: [
      { Goal: 1, Reward: { Credits: 20 } },
      { Goal: 5, Reward: { Credits: 50 } },
      { Goal: 10, Reward: { Credits: 100 } },
    ],
  },
  {
    Id: 'GiftsSent', Category: 'Social', Name: '선물 보내기', Desc: '친구에게 선물 {Goal}번 보내기', Stat: 'GiftsSent',
    Tiers: [
      { Goal: 1, Reward: { Items: { Item_StaminaS: 2 } } },
      { Goal: 10, Reward: { Credits: 50 } },
      { Goal: 50, Reward: { Credits: 150 } },
    ],
  },
  {
    Id: 'AllCharacters', Category: 'Social', Name: '모두와 함께', Desc: '캐릭터 {Goal}명과 각각 퀴즈 끝내기', Stat: 'CharactersPlayed',
    Tiers: [{ Goal: 3, Reward: { Credits: 100 } }],
  },
  {
    Id: 'LuckyHits', Category: 'Social', Name: '행운이 터졌다', Desc: '행운 스킬 {Goal}번 터뜨리기', Stat: 'LuckyHits',
    Tiers: [
      { Goal: 10, Reward: { Credits: 30 } },
      { Goal: 50, Reward: { Credits: 80 } },
      { Goal: 200, Reward: { Title: 'Title_Lucky' } },
    ],
  },
  {
    Id: 'FocusMax', Category: 'Social', Name: '최고 집중', Desc: '집중력 스킬 최고 배율(×1.4)에 {Goal}판 도달하기', Stat: 'FocusMaxQuizzes',
    Tiers: [
      { Goal: 5, Reward: { Credits: 30 } },
      { Goal: 20, Reward: { Credits: 80 } },
      { Goal: 50, Reward: { Title: 'Title_Focus' } },
    ],
  },
];

export function findAchievement(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.Id === id);
}

export function tierReached(a: Achievement, progress: number | undefined, tier: Tier): boolean {
  if (progress == null) return false;
  return a.LowerIsBetter ? progress > 0 && progress <= tier.Goal : progress >= tier.Goal;
}

/** 아직 줄 수 없는 보상(준비 중인 전용 의상)이 있는 단계인가 */
export function tierLocked(tier: Tier): boolean {
  return !!tier.Reward.Outfit && !EXCLUSIVE_OUTFITS_READY.has(tier.Reward.Outfit);
}
