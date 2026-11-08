// ========================================
// profileStore.ts - 공개 프로필(PlayerProfiles) 읽기/만들기 공통
//   PlayerProfiles: PK PlayerID. Nickname, NicknameTag(N), FriendCode, CreatedAt, UpdatedAt
//     GSI NicknameIndex (PK Nickname, SK NicknameTag) - 2단계 닉네임 검색용
//   PlayerHandles:  PK Handle ('CODE#K7Q2MX' / 'NICK#용감한판다#2381') → PlayerID
//     코드와 닉네임#번호가 겹치지 않게 조건부 Put 으로 잡는다
// ========================================

import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  HANDLE_TABLE,
  PROFILE_TABLE,
  NICKNAME_ADJECTIVES,
  NICKNAME_NOUNS,
  formatFriendCode,
  handleForCode,
  randomFriendCode,
} from './profileCatalog';
import { TITLES } from './achievementCatalog';

export const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });

export interface PlayerProfile {
  PlayerID: string;
  Nickname?: string;
  NicknameTag?: number;
  FriendCode?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
  BestRecords?: Record<string, { Score: number; Time: number; Plays: number; At: string }>;
  EquippedTitle?: string; // 도전과제 3단계: 고른 칭호 ID (Title_…). 없으면 칭호 없음
}

// 칭호 ID → 보여 줄 이름 (없는 ID 면 빈 값)
export function titleNameOf(id?: string): string {
  return id ? TITLES[id] ?? '' : '';
}

export async function readProfile(playerId: string): Promise<PlayerProfile | undefined> {
  const r = await dynamoDBClient.send(
    new GetItemCommand({ TableName: PROFILE_TABLE, Key: marshall({ PlayerID: playerId }), ConsistentRead: true })
  );
  return r.Item ? (unmarshall(r.Item) as PlayerProfile) : undefined;
}

export function isConditionFailure(e: unknown): boolean {
  if (e instanceof TransactionCanceledException) return true;
  return (e as { name?: string })?.name === 'TransactionCanceledException' || (e as { name?: string })?.name === 'ConditionalCheckFailedException';
}

// 프로필이 없거나 친구 코드가 없으면 새 코드를 잡아 만든다. 동시에 두 번 불려도 코드는 하나만 남는다
export async function ensureProfile(playerId: string): Promise<PlayerProfile> {
  let profile = await readProfile(playerId);
  if (profile?.FriendCode) return profile;

  const now = new Date().toISOString();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomFriendCode();
    try {
      await dynamoDBClient.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: HANDLE_TABLE,
                Item: marshall({ Handle: handleForCode(code), PlayerID: playerId, CreatedAt: now }),
                ConditionExpression: 'attribute_not_exists(Handle)',
              },
            },
            {
              Update: {
                TableName: PROFILE_TABLE,
                Key: marshall({ PlayerID: playerId }),
                UpdateExpression: 'SET FriendCode = :code, CreatedAt = if_not_exists(CreatedAt, :now), UpdatedAt = :now',
                ConditionExpression: 'attribute_not_exists(FriendCode)',
                ExpressionAttributeValues: marshall({ ':code': code, ':now': now }),
              },
            },
          ],
        })
      );
      break;
    } catch (e) {
      if (!isConditionFailure(e)) throw e;
      // 코드가 겹쳤거나, 다른 요청이 먼저 코드를 만들었다
      profile = await readProfile(playerId);
      if (profile?.FriendCode) return profile;
    }
  }
  profile = await readProfile(playerId);
  if (!profile?.FriendCode) throw new Error('could not allocate friend code');
  return profile;
}

// 앱으로 보내는 모양
export function toClientProfile(p: PlayerProfile) {
  return {
    PlayerID: p.PlayerID,
    Nickname: p.Nickname ?? '',
    NicknameTag: p.NicknameTag ?? 0,
    FriendCode: p.FriendCode ? formatFriendCode(p.FriendCode) : '',
    TitleId: p.EquippedTitle ?? '',
    Title: titleNameOf(p.EquippedTitle),
  };
}

export const NICKNAME_WORDS = { Adjectives: NICKNAME_ADJECTIVES, Nouns: NICKNAME_NOUNS };
