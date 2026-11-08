// ========================================
// friendActions.ts - 친구 관계를 바꾸는 공통 동작 (두 사람 쪽 줄을 한 트랜잭션으로)
// ========================================

import { TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { dynamoDBClient } from './profileStore';
import { FRIEND_TABLE, FriendStatus, MAX_FRIENDS, countStatus, listRows } from './friendStore';

type Items = NonNullable<ConstructorParameters<typeof TransactWriteItemsCommand>[0]['TransactItems']>;

const key = (a: string, b: string) => marshall({ PlayerID: a, OtherID: b });

export function putRow(owner: string, other: string, status: FriendStatus, now: string, condition?: string, values?: Record<string, unknown>) {
  return {
    Put: {
      TableName: FRIEND_TABLE,
      Item: marshall({ PlayerID: owner, OtherID: other, Status: status, CreatedAt: now, UpdatedAt: now }),
      ...(condition ? { ConditionExpression: condition } : {}),
      ...(values ? { ExpressionAttributeValues: marshall(values) } : {}),
    },
  };
}

export function setStatus(owner: string, other: string, status: FriendStatus, now: string, expected: FriendStatus) {
  return {
    Update: {
      TableName: FRIEND_TABLE,
      Key: key(owner, other),
      UpdateExpression: 'SET #s = :s, UpdatedAt = :now',
      ConditionExpression: '#s = :expected',
      ExpressionAttributeNames: { '#s': 'Status' },
      ExpressionAttributeValues: marshall({ ':s': status, ':now': now, ':expected': expected }),
    },
  };
}

export function deleteRow(owner: string, other: string) {
  return { Delete: { TableName: FRIEND_TABLE, Key: key(owner, other) } };
}

export async function transact(items: Items) {
  await dynamoDBClient.send(new TransactWriteItemsCommand({ TransactItems: items }));
}

// 받은 요청 수락: 내 줄 Received → Friend, 상대 줄 Sent → Friend. 둘 다 친구 수 한도 안이어야 한다
export async function acceptRequest(me: string, other: string): Promise<'ok' | 'MyFriendsFull' | 'TheirFriendsFull'> {
  const [mine, theirs] = await Promise.all([listRows(me), listRows(other)]);
  if (countStatus(mine, 'Friend') >= MAX_FRIENDS) return 'MyFriendsFull';
  if (countStatus(theirs, 'Friend') >= MAX_FRIENDS) return 'TheirFriendsFull';
  const now = new Date().toISOString();
  await transact([setStatus(me, other, 'Friend', now, 'Received'), setStatus(other, me, 'Friend', now, 'Sent')]);
  return 'ok';
}
