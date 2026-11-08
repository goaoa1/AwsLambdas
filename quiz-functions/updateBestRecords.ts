// ========================================
// updateBestRecords.ts - QuizResults 스트림(새 항목)을 받아 PlayerProfiles.BestRecords 를 갱신한다
//   API 경로 없음. 이벤트 소스 매핑: QuizResults 스트림(NEW_IMAGE) → 이 함수.
//   같은 결과가 두 번 와도 Plays 가 한 번만 늘도록 처리한 결과의 Timestamp 를 LastResultAt 으로 기억한다.
// ========================================

import type { DynamoDBStreamEvent } from 'aws-lambda';
import { GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { PROFILE_TABLE } from './profileCatalog';
import { dynamoDBClient } from './profileStore';
import { BestRecords, QuizResultLike, isCompleted, mergeResult } from './bestRecords';

export const handler = async (event: DynamoDBStreamEvent) => {
  for (const rec of event.Records) {
    if (rec.eventName !== 'INSERT' || !rec.dynamodb?.NewImage) continue;
    const item = unmarshall(rec.dynamodb.NewImage as Record<string, AttributeValue>) as QuizResultLike & { PlayerID: string; Timestamp: number };
    if (!item.PlayerID || !isCompleted(item)) continue;

    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await dynamoDBClient.send(
        new GetItemCommand({ TableName: PROFILE_TABLE, Key: marshall({ PlayerID: item.PlayerID }), ProjectionExpression: 'BestRecords, LastResultAt', ConsistentRead: true })
      );
      const data = cur.Item ? unmarshall(cur.Item) : {};
      const last = Number(data.LastResultAt ?? 0);
      if (last >= Number(item.Timestamp)) break; // 이미 반영한 결과
      const next: BestRecords = mergeResult((data.BestRecords as BestRecords) ?? {}, item);
      try {
        await dynamoDBClient.send(
          new UpdateItemCommand({
            TableName: PROFILE_TABLE,
            Key: marshall({ PlayerID: item.PlayerID }),
            UpdateExpression: 'SET BestRecords = :r, LastResultAt = :t',
            ConditionExpression: 'attribute_not_exists(LastResultAt) OR LastResultAt = :last',
            ExpressionAttributeValues: marshall({ ':r': next, ':t': Number(item.Timestamp), ':last': last }),
          })
        );
        console.log(`[UpdateBestRecords] ${item.PlayerID} quiz ${item.QuizID} score ${item.Score}`);
        break;
      } catch (e) {
        if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e;
        // 동시에 다른 결과가 반영됨 → 다시 읽고 합친다
      }
    }
  }
};
