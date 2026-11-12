// ========================================
// storyStore.ts - 스토리 진행 저장 (PlayerResources.Story: { "Char_001": { Affinity, Seen[], ... } })
//   기기 저장(SG_Story)과 같은 모양. 합칠 때 호감도는 큰 쪽, 목록은 합집합, 날짜는 늦은 쪽 — 어느 기기에서 먼저 보내도 잃지 않는다.
//   중첩 경로(#story.#c)를 쓰려면 Story 맵이 먼저 있어야 해서 ensureStoryMap 을 앞에 부른다 (inventoryStore 와 같은 방식).
// ========================================
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

export const PLAYER_TABLE = 'PlayerResources';
const client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });

export interface StoryCharState {
  Affinity: number;
  Seen: string[];       // 본 에피소드 id
  Events: string[];     // 1회성 이벤트 반응 id
  Flags: string[];      // first_quiz_done, best_score_beaten, stage17_played …
  Unlocked: string[];   // 에피소드가 연 것 (greeting_tier2, shop_item_blouse, potion_reaction …)
  Claimed: string[];    // 보상을 실제로 받은 해금 id
  Choices: Record<string, string>;
  LastEpisodeDate: string;
  TapDate: string;
  TapPointsToday: number;
  UpdatedAt: string;
}
export type StoryMap = Record<string, StoryCharState>;

export const CHARACTER_IDS = new Set(['Char_001', 'Char_002', 'Char_003']);
/** update-story 가 받는 키: 세 캐릭터 + 'Reality'(현실 연결: 본 번외 seen_extra11 … 를 Flags 로, 2026-11-12) */
export const STORY_KEYS = new Set([...CHARACTER_IDS, 'Reality']);

export function emptyCharState(): StoryCharState {
  return { Affinity: 0, Seen: [], Events: [], Flags: [], Unlocked: [], Claimed: [], Choices: {}, LastEpisodeDate: '', TapDate: '', TapPointsToday: 0, UpdatedAt: '' };
}

const strList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (v instanceof Set) return [...v].map(String);
  return [];
};

export function normalizeCharState(raw: unknown): StoryCharState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const choices: Record<string, string> = {};
  if (r.Choices && typeof r.Choices === 'object') for (const [k, v] of Object.entries(r.Choices as Record<string, unknown>)) choices[k] = String(v);
  return {
    Affinity: Math.max(0, Math.floor(Number(r.Affinity) || 0)),
    Seen: strList(r.Seen),
    Events: strList(r.Events),
    Flags: strList(r.Flags),
    Unlocked: strList(r.Unlocked),
    Claimed: strList(r.Claimed),
    Choices: choices,
    LastEpisodeDate: typeof r.LastEpisodeDate === 'string' ? r.LastEpisodeDate : '',
    TapDate: typeof r.TapDate === 'string' ? r.TapDate : '',
    TapPointsToday: Math.max(0, Math.floor(Number(r.TapPointsToday) || 0)),
    UpdatedAt: typeof r.UpdatedAt === 'string' ? r.UpdatedAt : '',
  };
}

export async function readStoryRow(playerId: string): Promise<{ Story: StoryMap; Row: Record<string, unknown> }> {
  const r = await client.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: playerId }),
      ProjectionExpression: 'PlayerID, #story, AttendanceStreak, TotalAttendanceDays, OwnedOutfits',
      ExpressionAttributeNames: { '#story': 'Story' },
    })
  );
  const row = r.Item ? unmarshall(r.Item) : {};
  const story: StoryMap = {};
  for (const [k, v] of Object.entries((row.Story as Record<string, unknown>) ?? {})) story[k] = normalizeCharState(v);
  return { Story: story, Row: row };
}

export async function readStory(playerId: string): Promise<StoryMap> {
  return (await readStoryRow(playerId)).Story;
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/** 두 상태를 합친다: 호감도 큰 쪽, 목록 합집합, 날짜 늦은 쪽, 탭 점수는 같은 날이면 큰 쪽 */
export function mergeCharState(cur: StoryCharState, patch: Partial<StoryCharState>): StoryCharState {
  const next: StoryCharState = { ...cur };
  if (patch.Affinity !== undefined) next.Affinity = Math.max(cur.Affinity, Math.floor(Number(patch.Affinity) || 0));
  if (patch.Seen) next.Seen = union(cur.Seen, strList(patch.Seen));
  if (patch.Events) next.Events = union(cur.Events, strList(patch.Events));
  if (patch.Flags) next.Flags = union(cur.Flags, strList(patch.Flags));
  if (patch.Unlocked) next.Unlocked = union(cur.Unlocked, strList(patch.Unlocked));
  if (patch.Claimed) next.Claimed = union(cur.Claimed, strList(patch.Claimed));
  if (patch.Choices) next.Choices = { ...cur.Choices, ...patch.Choices };
  if (patch.LastEpisodeDate && patch.LastEpisodeDate > cur.LastEpisodeDate) next.LastEpisodeDate = patch.LastEpisodeDate;
  if (patch.TapDate) {
    if (patch.TapDate > cur.TapDate) { next.TapDate = patch.TapDate; next.TapPointsToday = Math.max(0, Number(patch.TapPointsToday) || 0); }
    else if (patch.TapDate === cur.TapDate) next.TapPointsToday = Math.max(cur.TapPointsToday, Number(patch.TapPointsToday) || 0);
  }
  next.UpdatedAt = new Date().toISOString();
  return next;
}

/** Story 맵이 없으면 빈 맵을 만든다 (플레이어 줄이 있을 때만) */
export async function ensureStoryMap(playerId: string) {
  try {
    await client.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: playerId }),
        UpdateExpression: 'SET #story = if_not_exists(#story, :empty)',
        ConditionExpression: 'attribute_exists(PlayerID)',
        ExpressionAttributeNames: { '#story': 'Story' },
        ExpressionAttributeValues: marshall({ ':empty': {} }),
      })
    );
  } catch (e) {
    if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e;
  }
}

export async function writeCharState(playerId: string, characterId: string, state: StoryCharState) {
  await ensureStoryMap(playerId);
  await client.send(
    new UpdateItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: playerId }),
      UpdateExpression: 'SET #story.#c = :s, UpdatedAt = :now',
      ConditionExpression: 'attribute_exists(PlayerID)',
      ExpressionAttributeNames: { '#story': 'Story', '#c': characterId },
      ExpressionAttributeValues: marshall({ ':s': state, ':now': new Date().toISOString() }, { removeUndefinedValues: true }),
    })
  );
}

/** 어떤 캐릭터의 이야기에서든 이 해금이 열렸는가 (상점 잠금 해제 판정) */
export function hasUnlock(story: StoryMap, unlockId: string): boolean {
  return Object.values(story).some((s) => s.Unlocked.includes(unlockId));
}
