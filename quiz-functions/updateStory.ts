// ========================================
// updateStory.ts - POST /update-story
//   { CharacterId, Affinity?, Seen?[], Events?[], Flags?[], Unlocked?[], Choices?{}, LastEpisodeDate?, TapDate?, TapPointsToday? }
//   서버 값과 합쳐(storyStore.mergeCharState) 저장하고 합친 결과를 돌려준다. 같은 요청을 두 번 보내도 결과가 같다.
//   오류 Reason: UnknownCharacter / InvalidBody
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getUserId, parseBody } from './friendStore';
import { STORY_KEYS, emptyCharState, mergeCharState, readStory, writeCharState, type StoryCharState } from './storyStore';

const MAX_LIST = 200;
const cleanList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length <= 64).slice(0, MAX_LIST) : undefined;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const body = parseBody<Record<string, unknown>>(event.body);
  const characterId = typeof body?.CharacterId === 'string' ? body.CharacterId : '';
  if (!body || !STORY_KEYS.has(characterId)) return createErrorResponse(400, 'Unknown character', { Reason: 'UnknownCharacter' });

  const patch: Partial<StoryCharState> = {};
  if (body.Affinity !== undefined) patch.Affinity = Math.min(100000, Math.max(0, Math.floor(Number(body.Affinity) || 0)));
  const seen = cleanList(body.Seen); if (seen) patch.Seen = seen;
  const events = cleanList(body.Events); if (events) patch.Events = events;
  const flags = cleanList(body.Flags); if (flags) patch.Flags = flags;
  const unlocked = cleanList(body.Unlocked); if (unlocked) patch.Unlocked = unlocked;
  if (body.Choices && typeof body.Choices === 'object') {
    patch.Choices = {};
    for (const [k, v] of Object.entries(body.Choices as Record<string, unknown>).slice(0, 50)) if (typeof v === 'string') patch.Choices[k] = v.slice(0, 32);
  }
  if (typeof body.LastEpisodeDate === 'string') patch.LastEpisodeDate = body.LastEpisodeDate.slice(0, 10);
  if (typeof body.TapDate === 'string') { patch.TapDate = body.TapDate.slice(0, 10); patch.TapPointsToday = Math.max(0, Math.floor(Number(body.TapPointsToday) || 0)); }

  try {
    const story = await readStory(me);
    const merged = mergeCharState(story[characterId] ?? emptyCharState(), patch);
    await writeCharState(me, characterId, merged);
    console.log(`[UpdateStory] ${me} ${characterId} affinity=${merged.Affinity} seen=${merged.Seen.length} flags=${merged.Flags.length}`);
    return createSuccessResponse({ CharacterId: characterId, Story: merged });
  } catch (e) {
    console.error('[UpdateStory] error', e);
    return createErrorResponse(500, 'Story error', { Reason: 'ServerError' });
  }
};
