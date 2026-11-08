// ========================================
// characterSkills.ts - 캐릭터 고유 스킬 (점수 배율). 숫자를 바꿀 때는 이 파일만 고친다 (2026-11-08)
//
//   Char_001 꾸준함 : 정답마다 ×1.2
//   Char_002 집중력 : 연속 정답마다 +0.05 (1.0 → 1.4, 9번째 연속 정답부터 1.4). 틀리면 1.0 으로
//   Char_003 행운   : 정답마다 50% 확률로 ×1.4, 아니면 ×1.0 (평균 1.2)
//
//   - 배율은 정답에만. 오답은 0점 그대로.
//   - 점수는 문제마다 반올림 (Math.round).
//   - 재도전(틀린 문제 다시 풀기)에도 같은 규칙. 2번의 연속 정답 수는 재도전에서도 이어서 센다.
//   - 세션에 없는 캐릭터(예전 세션, 알 수 없는 ID)는 배율 1.0.
// ========================================

export type SkillId = 'Steady' | 'Focus' | 'Lucky' | 'None';

export interface SkillState {
  Streak: number; // 지금까지 연속 정답 수 (이번 답 전)
}

export interface SkillOutcome {
  SkillId: SkillId;
  Multiplier: number;      // 이번 답에 쓴 배율 (오답이면 1)
  BaseScore: number;       // 배율 전 점수
  Score: number;           // 배율 적용 후 점수 (정수)
  Bonus: number;           // Score - BaseScore
  SkillTriggered: boolean; // 3번 행운이 터졌는지, 2번이 최고 배율인지
  Streak: number;          // 이번 답 뒤 연속 정답 수
}

export const SKILLS: Record<string, SkillId> = {
  Char_001: 'Steady',
  Char_002: 'Focus',
  Char_003: 'Lucky',
};

export const STEADY_MULTIPLIER = 1.2;
export const FOCUS_STEP = 0.05;
export const FOCUS_MAX = 1.4;
export const LUCKY_MULTIPLIER = 1.4;
export const LUCKY_CHANCE = 0.5;

export function skillFor(characterId: string | undefined): SkillId {
  return (characterId && SKILLS[characterId]) || 'None';
}

/** 2번 집중력: 이번 답 전에 연속 정답이 streak 개일 때 이번 정답의 배율 */
export function focusMultiplier(streakBefore: number): number {
  return Math.min(FOCUS_MAX, Math.round((1 + FOCUS_STEP * Math.max(0, streakBefore)) * 100) / 100);
}

export function applySkill(
  characterId: string | undefined,
  isCorrect: boolean,
  baseScore: number,
  state: SkillState,
  random: () => number = Math.random
): SkillOutcome {
  const skill = skillFor(characterId);
  const streakBefore = Math.max(0, state.Streak || 0);
  const base = Number(baseScore) || 0;

  if (!isCorrect) {
    return { SkillId: skill, Multiplier: 1, BaseScore: base, Score: base, Bonus: 0, SkillTriggered: false, Streak: 0 };
  }

  let multiplier = 1;
  let triggered = false;
  switch (skill) {
    case 'Steady':
      multiplier = STEADY_MULTIPLIER;
      break;
    case 'Focus':
      multiplier = focusMultiplier(streakBefore);
      triggered = multiplier >= FOCUS_MAX;
      break;
    case 'Lucky':
      triggered = random() < LUCKY_CHANCE;
      multiplier = triggered ? LUCKY_MULTIPLIER : 1;
      break;
    default:
      multiplier = 1;
  }
  const score = Math.round(base * multiplier);
  return {
    SkillId: skill,
    Multiplier: multiplier,
    BaseScore: base,
    Score: score,
    Bonus: score - base,
    SkillTriggered: triggered,
    Streak: streakBefore + 1,
  };
}
