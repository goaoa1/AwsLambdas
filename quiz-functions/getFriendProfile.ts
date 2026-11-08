// ========================================
// getFriendProfile.ts - 친구(또는 나)의 프로필
//   POST /get-friend-profile { FriendCode }
//   친구 사이일 때만 보여 준다 (아니면 403 NotFriends). 내 코드를 넣으면 내 프로필.
//   보여 주는 것: 닉네임·번호·코드, 고른 캐릭터와 입은 의상, 연속/총 출석일, 단별 최고 기록, 친구가 된 날
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { PROFILE_TABLE, formatFriendCode } from './profileCatalog';
import { dynamoDBClient, titleNameOf } from './profileStore';
import { Reason, getRow, getUserId, parseBody, resolveFriendCode } from './friendStore';

const PLAYER_TABLE = 'PlayerResources';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');
  const body = parseBody<{ FriendCode?: string }>(event.body);

  try {
    const other = await resolveFriendCode(String(body?.FriendCode ?? ''));
    if (!other) return createErrorResponse(404, 'Not found', { Reason: Reason.NotFound });
    let since: string | undefined;
    if (other !== me) {
      const row = await getRow(me, other);
      if (row?.Status !== 'Friend') return createErrorResponse(403, 'Not friends', { Reason: Reason.NotFriends });
      since = row.UpdatedAt;
    }

    const [prof, res] = await Promise.all([
      dynamoDBClient.send(new GetItemCommand({ TableName: PROFILE_TABLE, Key: marshall({ PlayerID: other }) })),
      dynamoDBClient.send(
        new GetItemCommand({
          TableName: PLAYER_TABLE,
          Key: marshall({ PlayerID: other }),
          ProjectionExpression: 'SelectedCharacterId, EquippedOutfits, AttendanceStreak, TotalAttendanceDays',
        })
      ),
    ]);
    const p = prof.Item ? unmarshall(prof.Item) : {};
    const r = res.Item ? unmarshall(res.Item) : {};
    return createSuccessResponse({
      Profile: {
        FriendCode: p.FriendCode ? formatFriendCode(p.FriendCode) : '',
        Nickname: p.Nickname ?? '',
        NicknameTag: p.NicknameTag ?? 0,
        Title: titleNameOf(p.EquippedTitle),
        IsMe: other === me,
        FriendsSince: since ?? '',
        SelectedCharacterId: r.SelectedCharacterId ?? '',
        EquippedOutfits: r.EquippedOutfits ?? {},
        AttendanceStreak: r.AttendanceStreak ?? 0,
        TotalAttendanceDays: r.TotalAttendanceDays ?? 0,
        BestRecords: p.BestRecords ?? {},
      },
    });
  } catch (e) {
    console.error('[GetFriendProfile] error', e);
    return createErrorResponse(500, 'Profile error', { Reason: 'ServerError' });
  }
};
