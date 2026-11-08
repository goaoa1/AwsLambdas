// ========================================
// setNickname.ts - 조합형 닉네임 정하기/바꾸기
//   POST /set-nickname  { Adjective: '용감한', Noun: '판다' }
//   목록에 있는 단어만 받는다. 같은 닉네임끼리는 4자리 번호(NicknameTag)로 구분하고,
//   'NICK#닉네임#번호' 를 PlayerHandles 에 조건부로 잡아 겹치지 않게 한다. 예전 닉네임 자리는 비운다.
//   응답 오류 Reason: InvalidNickname(400), Busy(409, 번호를 못 잡음)
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { HANDLE_TABLE, PROFILE_TABLE, handleForNickname, isValidNickname, makeNickname, randomNicknameTag } from './profileCatalog';
import { dynamoDBClient, ensureProfile, isConditionFailure, readProfile, toClientProfile } from './profileStore';

export const handler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext?.authorizer?.claims?.sub as string | undefined;
  if (!userId) {
    return createErrorResponse(401, 'Unauthorized');
  }

  let body: { Adjective?: string; Noun?: string } = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return createErrorResponse(400, 'Invalid body', { Reason: 'InvalidNickname' });
  }
  const adjective = String(body.Adjective ?? '');
  const noun = String(body.Noun ?? '');
  if (!isValidNickname(adjective, noun)) {
    return createErrorResponse(400, 'Invalid nickname', { Reason: 'InvalidNickname' });
  }
  const nickname = makeNickname(adjective, noun);

  try {
    // 친구 코드가 아직 없으면 같이 만든다 (닉네임보다 먼저 불리지 않았을 때 대비)
    const current = await ensureProfile(userId);
    if (current.Nickname === nickname && current.NicknameTag) {
      return createSuccessResponse({ Profile: toClientProfile(current) });
    }

    const now = new Date().toISOString();
    for (let attempt = 0; attempt < 8; attempt++) {
      const tag = randomNicknameTag();
      const items: NonNullable<ConstructorParameters<typeof TransactWriteItemsCommand>[0]['TransactItems']> = [
        {
          Put: {
            TableName: HANDLE_TABLE,
            Item: marshall({ Handle: handleForNickname(nickname, tag), PlayerID: userId, CreatedAt: now }),
            ConditionExpression: 'attribute_not_exists(Handle)',
          },
        },
        {
          Update: {
            TableName: PROFILE_TABLE,
            Key: marshall({ PlayerID: userId }),
            UpdateExpression: 'SET Nickname = :n, NicknameTag = :t, UpdatedAt = :now',
            ExpressionAttributeValues: marshall({ ':n': nickname, ':t': tag, ':now': now }),
          },
        },
      ];
      if (current.Nickname && current.NicknameTag) {
        items.push({
          Delete: {
            TableName: HANDLE_TABLE,
            Key: marshall({ Handle: handleForNickname(current.Nickname, current.NicknameTag) }),
            ConditionExpression: 'attribute_not_exists(Handle) OR PlayerID = :me',
            ExpressionAttributeValues: marshall({ ':me': userId }),
          },
        });
      }
      try {
        await dynamoDBClient.send(new TransactWriteItemsCommand({ TransactItems: items }));
        const updated = await readProfile(userId);
        console.log(`[SetNickname] ${userId} -> ${nickname}#${tag}`);
        return createSuccessResponse({ Profile: toClientProfile(updated ?? { ...current, Nickname: nickname, NicknameTag: tag }) });
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
        // 번호가 겹침 → 다른 번호로 다시
      }
    }
    return createErrorResponse(409, 'Nickname busy', { Reason: 'Busy' });
  } catch (e) {
    console.error('[SetNickname] error', e);
    return createErrorResponse(500, 'Nickname error', { Reason: 'ServerError' });
  }
};
