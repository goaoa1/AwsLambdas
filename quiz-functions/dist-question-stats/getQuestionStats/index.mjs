// getQuestionStats.ts
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";

// friendStore.ts
import { BatchGetItemCommand, GetItemCommand as GetItemCommand2, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall2, unmarshall as unmarshall2 } from "@aws-sdk/util-dynamodb";

// profileStore.ts
import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
var dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });

// friendStore.ts
function getUserId(event) {
  return event.requestContext?.authorizer?.claims?.sub;
}

// questionStats.ts
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand3, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
var QUESTION_STATS_TABLE = "PlayerQuestionStats";
var ddb = new DynamoDBClient2({ region: process.env.REGION });
async function readStats(playerId) {
  const res = await ddb.send(
    new GetItemCommand3({ TableName: QUESTION_STATS_TABLE, Key: { PlayerID: { S: playerId } }, ConsistentRead: true })
  );
  const out = {};
  for (const [name, value] of Object.entries(res.Item || {})) {
    const m = /^([AC])_(.+)$/.exec(name);
    if (!m || value.N === void 0) continue;
    const row = out[m[2]] ??= { A: 0, C: 0 };
    row[m[1]] = Number(value.N);
  }
  return out;
}

// getQuestionStats.ts
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  try {
    return createSuccessResponse({ Stats: await readStats(me) });
  } catch (e) {
    console.error("[GetQuestionStats]", e);
    return createErrorResponse(500, "Failed to load question stats");
  }
};
export {
  handler
};
