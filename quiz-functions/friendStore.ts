// ========================================
// friendStore.ts - 친구 관계(Friends 테이블) 공통
//   Friends: PK PlayerID, SK OtherID, Status = Friend | Sent | Received | Blocked, CreatedAt, UpdatedAt
//   한 관계는 두 줄(내 쪽, 상대 쪽)로 저장하고 항상 한 트랜잭션에서 같이 바꾼다.
//   Blocked 는 막은 사람 쪽에만 있고, 막힌 사람 쪽 줄은 지운다 (막힌 사람은 모름).
//   앱에는 PlayerID(Cognito sub) 대신 친구 코드로만 상대를 가리킨다.
// ========================================

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { BatchGetItemCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { HANDLE_TABLE, PROFILE_TABLE, formatFriendCode, handleForCode, normalizeFriendCode } from './profileCatalog';
import { PlayerProfile, dynamoDBClient, titleNameOf } from './profileStore';

export const FRIEND_TABLE = 'Friends';
export const MAX_FRIENDS = 50;
export const MAX_RECEIVED = 20;
export const MAX_SENT = 20;

export type FriendStatus = 'Friend' | 'Sent' | 'Received' | 'Blocked';

export interface FriendRow {
  PlayerID: string;
  OtherID: string;
  Status: FriendStatus;
  CreatedAt?: string;
  UpdatedAt?: string;
}

export function getUserId(event: APIGatewayProxyEvent): string | undefined {
  return event.requestContext?.authorizer?.claims?.sub as string | undefined;
}

export function parseBody<T>(body: string | null | undefined): T | undefined {
  try {
    return JSON.parse(body || '{}') as T;
  } catch {
    return undefined;
  }
}

// 친구 코드 → PlayerID (없으면 undefined)
export async function resolveFriendCode(input: string): Promise<string | undefined> {
  const code = normalizeFriendCode(input);
  if (!code) return undefined;
  const r = await dynamoDBClient.send(new GetItemCommand({ TableName: HANDLE_TABLE, Key: marshall({ Handle: handleForCode(code) }) }));
  return r.Item ? (unmarshall(r.Item).PlayerID as string) : undefined;
}

export async function getRow(playerId: string, otherId: string): Promise<FriendRow | undefined> {
  const r = await dynamoDBClient.send(
    new GetItemCommand({ TableName: FRIEND_TABLE, Key: marshall({ PlayerID: playerId, OtherID: otherId }), ConsistentRead: true })
  );
  return r.Item ? (unmarshall(r.Item) as FriendRow) : undefined;
}

export async function listRows(playerId: string): Promise<FriendRow[]> {
  const rows: FriendRow[] = [];
  let start: Record<string, any> | undefined;
  do {
    const r = await dynamoDBClient.send(
      new QueryCommand({
        TableName: FRIEND_TABLE,
        KeyConditionExpression: 'PlayerID = :p',
        ExpressionAttributeValues: marshall({ ':p': playerId }),
        ExclusiveStartKey: start,
        ConsistentRead: true,
      })
    );
    for (const it of r.Items ?? []) rows.push(unmarshall(it) as FriendRow);
    start = r.LastEvaluatedKey;
  } while (start);
  return rows;
}

export function countStatus(rows: FriendRow[], status: FriendStatus): number {
  return rows.filter((r) => r.Status === status).length;
}

export async function getProfiles(ids: string[]): Promise<Map<string, PlayerProfile>> {
  const out = new Map<string, PlayerProfile>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    let keys: Record<string, any>[] = unique.slice(i, i + 100).map((id) => marshall({ PlayerID: id }));
    for (let attempt = 0; attempt < 5 && keys.length; attempt++) {
      const r = await dynamoDBClient.send(
        new BatchGetItemCommand({ RequestItems: { [PROFILE_TABLE]: { Keys: keys, ProjectionExpression: 'PlayerID, Nickname, NicknameTag, FriendCode, BestRecords, EquippedTitle' } } })
      );
      for (const it of r.Responses?.[PROFILE_TABLE] ?? []) {
        const p = unmarshall(it) as PlayerProfile;
        out.set(p.PlayerID, p);
      }
      keys = (r.UnprocessedKeys?.[PROFILE_TABLE]?.Keys as Record<string, any>[]) ?? [];
    }
  }
  return out;
}

// 앱으로 보내는 한 줄. Status 는 '나' 기준 (None = 아무 관계 없음)
export function toEntry(p: PlayerProfile | undefined, status: FriendStatus | 'None' | 'Self') {
  return {
    FriendCode: p?.FriendCode ? formatFriendCode(p.FriendCode) : '',
    Nickname: p?.Nickname ?? '',
    NicknameTag: p?.NicknameTag ?? 0,
    Title: titleNameOf(p?.EquippedTitle),
    Status: status,
  };
}

// 공통 오류 응답에 쓰는 Reason 값
export const Reason = {
  NotFound: 'NotFound',             // 코드에 맞는 사람이 없음 (나를 막은 사람도 이렇게 보임)
  Self: 'Self',                     // 나 자신
  NoNickname: 'NoNickname',         // 내 닉네임을 먼저 정해야 함
  AlreadyFriends: 'AlreadyFriends',
  AlreadySent: 'AlreadySent',
  Blocked: 'Blocked',               // 내가 막은 사람 (먼저 차단을 풀어야 함)
  MyFriendsFull: 'MyFriendsFull',
  TheirFriendsFull: 'TheirFriendsFull',
  MySentFull: 'MySentFull',
  TheirInboxFull: 'TheirInboxFull',
  NoRequest: 'NoRequest',           // 받은 요청이 없음 (상대가 취소함 등)
  NotFriends: 'NotFriends',
  InvalidInput: 'InvalidInput',
} as const;
