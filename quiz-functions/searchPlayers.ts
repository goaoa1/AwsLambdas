// ========================================
// searchPlayers.ts - 친구 찾기
//   POST /search-players { Query }
//   Query 가 친구 코드 모양(K7Q-2MX, 하이픈·대소문자 상관없음)이면 코드로, 아니면 닉네임으로 찾는다.
//   닉네임은 전체가 같아야 한다: '상냥한햄스터' (같은 닉네임 모두, 최대 10명) 또는 '상냥한햄스터#5974'.
//   나를 차단한 사람은 결과에서 빠진다. 결과의 Status 는 나와의 관계(None/Friend/Sent/Received/Blocked/Self).
//   보여 주는 것은 닉네임·번호·코드뿐이다.
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { PROFILE_TABLE, normalizeFriendCode } from './profileCatalog';
import { dynamoDBClient } from './profileStore';
import { Reason, getProfiles, getRow, getUserId, parseBody, resolveFriendCode, toEntry } from './friendStore';

const MAX_RESULTS = 10;

async function findByNickname(query: string): Promise<string[]> {
  const m = query.replace(/\s/g, '').match(/^(.+?)(?:#(\d{4}))?$/);
  if (!m) return [];
  const nickname = m[1];
  const tag = m[2] ? Number(m[2]) : undefined;
  const r = await dynamoDBClient.send(
    new QueryCommand({
      TableName: PROFILE_TABLE,
      IndexName: 'NicknameIndex',
      KeyConditionExpression: tag === undefined ? 'Nickname = :n' : 'Nickname = :n AND NicknameTag = :t',
      ExpressionAttributeValues: marshall(tag === undefined ? { ':n': nickname } : { ':n': nickname, ':t': tag }),
      Limit: 30,
    })
  );
  return (r.Items ?? []).map((it) => unmarshall(it).PlayerID as string);
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const body = parseBody<{ Query?: string }>(event.body);
  const query = String(body?.Query ?? '').trim();
  if (!query || query.length > 40) return createErrorResponse(400, 'Invalid query', { Reason: Reason.InvalidInput });

  try {
    let ids: string[] = [];
    if (normalizeFriendCode(query)) {
      const id = await resolveFriendCode(query);
      if (id) ids = [id];
    }
    if (ids.length === 0) {
      ids = await findByNickname(query);
    }

    const results = [];
    const profiles = await getProfiles(ids);
    for (const id of ids) {
      if (results.length >= MAX_RESULTS) break;
      const p = profiles.get(id);
      if (!p?.FriendCode || !p.Nickname) continue; // 닉네임을 아직 안 정한 사람은 안 보임
      if (id === me) {
        results.push(toEntry(p, 'Self'));
        continue;
      }
      const theirs = await getRow(id, me);
      if (theirs?.Status === 'Blocked') continue; // 나를 막은 사람
      const mine = await getRow(me, id);
      results.push(toEntry(p, mine?.Status ?? 'None'));
    }
    console.log(`[SearchPlayers] ${me} '${query}' -> ${results.length}`);
    return createSuccessResponse({ Results: results });
  } catch (e) {
    console.error('[SearchPlayers] error', e);
    return createErrorResponse(500, 'Search error', { Reason: 'ServerError' });
  }
};
