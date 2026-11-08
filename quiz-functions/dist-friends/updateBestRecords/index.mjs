// updateBestRecords.ts
import { GetItemCommand as GetItemCommand2, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall2, unmarshall as unmarshall2 } from "@aws-sdk/util-dynamodb";

// profileCatalog.ts
var PROFILE_TABLE = "PlayerProfiles";

// profileStore.ts
import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
var dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });

// bestRecords.ts
function isCompleted(r) {
  if (r.QuizID === void 0 || r.QuizID === null || r.QuizID === "") return false;
  if (typeof r.Score !== "number") return false;
  if (typeof r.QuestionCount === "number" && typeof r.CurrentQuestionIndex === "number") {
    return r.CurrentQuestionIndex >= r.QuestionCount;
  }
  return true;
}
function better(a, b) {
  if (!b) return true;
  if (a.Score !== b.Score) return a.Score > b.Score;
  return a.Time < b.Time;
}
function mergeResult(records, r) {
  const id = String(r.QuizID);
  const prev = records[id];
  const cand = { Score: Number(r.Score ?? 0), Time: Math.round(Number(r.ElapsedTime ?? 0) * 10) / 10 };
  const plays = (prev?.Plays ?? 0) + 1;
  const next = { ...records };
  next[id] = better(cand, prev) ? { Score: cand.Score, Time: cand.Time, Plays: plays, At: r.CreatedAt ?? (/* @__PURE__ */ new Date()).toISOString() } : { ...prev, Plays: plays };
  return next;
}

// updateBestRecords.ts
var handler = async (event) => {
  for (const rec of event.Records) {
    if (rec.eventName !== "INSERT" || !rec.dynamodb?.NewImage) continue;
    const item = unmarshall2(rec.dynamodb.NewImage);
    if (!item.PlayerID || !isCompleted(item)) continue;
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await dynamoDBClient.send(
        new GetItemCommand2({ TableName: PROFILE_TABLE, Key: marshall2({ PlayerID: item.PlayerID }), ProjectionExpression: "BestRecords, LastResultAt", ConsistentRead: true })
      );
      const data = cur.Item ? unmarshall2(cur.Item) : {};
      const last = Number(data.LastResultAt ?? 0);
      if (last >= Number(item.Timestamp)) break;
      const next = mergeResult(data.BestRecords ?? {}, item);
      try {
        await dynamoDBClient.send(
          new UpdateItemCommand({
            TableName: PROFILE_TABLE,
            Key: marshall2({ PlayerID: item.PlayerID }),
            UpdateExpression: "SET BestRecords = :r, LastResultAt = :t",
            ConditionExpression: "attribute_not_exists(LastResultAt) OR LastResultAt = :last",
            ExpressionAttributeValues: marshall2({ ":r": next, ":t": Number(item.Timestamp), ":last": last })
          })
        );
        console.log(`[UpdateBestRecords] ${item.PlayerID} quiz ${item.QuizID} score ${item.Score}`);
        break;
      } catch (e) {
        if (e.name !== "ConditionalCheckFailedException") throw e;
      }
    }
  }
};
export {
  handler
};
