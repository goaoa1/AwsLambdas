// claimShopBonus.ts
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand3, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall3, unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";
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
function parseBody(body) {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return void 0;
  }
}

// claimShopBonus.ts
var client = new DynamoDBClient2({ region: process.env.REGION || process.env.AWS_REGION });
var PLAYER_TABLE = "PlayerResources";
var SHOP_BONUS_CREDITS = 3;
var SHOP_BONUS_DAILY_CAP = 3;
function todayKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1e3).toISOString().slice(0, 10);
}
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  const body = parseBody(event.body);
  const table = Math.floor(Number(body?.Table));
  const count = Math.floor(Number(body?.Count));
  if (!(table >= 11 && table <= 19) || !(count >= 1 && count <= 19)) {
    return createErrorResponse(400, "Invalid table or count", { Reason: "InvalidBody" });
  }
  const today = todayKST();
  const got = await client.send(
    new GetItemCommand3({
      TableName: PLAYER_TABLE,
      Key: marshall3({ PlayerID: me }),
      ProjectionExpression: "Credits, ShopBonusDate, ShopBonusToday"
    })
  );
  const row = got.Item ? unmarshall3(got.Item) : {};
  const used = row.ShopBonusDate === today ? Math.max(0, Number(row.ShopBonusToday) || 0) : 0;
  if (used >= SHOP_BONUS_DAILY_CAP) {
    return createSuccessResponse({ Granted: 0, Credits: Number(row.Credits) || 0, Remaining: 0, Reason: "DailyCap" });
  }
  try {
    const r = await client.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall3({ PlayerID: me }),
        UpdateExpression: "SET Credits = if_not_exists(Credits, :zero) + :credits, ShopBonusDate = :today, ShopBonusToday = :next, UpdatedAt = :now",
        // 읽은 값 그대로일 때만 (동시에 두 번 눌러 한도를 넘지 않게)
        ConditionExpression: used === 0 ? "attribute_exists(PlayerID) AND (attribute_not_exists(ShopBonusDate) OR ShopBonusDate <> :today OR ShopBonusToday = :used)" : "attribute_exists(PlayerID) AND ShopBonusDate = :today AND ShopBonusToday = :used",
        ExpressionAttributeValues: marshall3({
          ":zero": 0,
          ":credits": SHOP_BONUS_CREDITS,
          ":today": today,
          ":next": used + 1,
          ":used": used,
          ":now": (/* @__PURE__ */ new Date()).toISOString()
        }),
        ReturnValues: "UPDATED_NEW"
      })
    );
    const credits = Number(r.Attributes ? unmarshall3(r.Attributes).Credits : 0) || 0;
    console.log(`[ClaimShopBonus] ${me} table=${table} count=${count} +${SHOP_BONUS_CREDITS} (${used + 1}/${SHOP_BONUS_DAILY_CAP}) credits=${credits}`);
    return createSuccessResponse({ Granted: SHOP_BONUS_CREDITS, Credits: credits, Remaining: SHOP_BONUS_DAILY_CAP - used - 1 });
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      return createErrorResponse(409, "Try again", { Reason: "Conflict" });
    }
    console.error("[ClaimShopBonus]", e);
    return createErrorResponse(500, "Failed to grant shop bonus");
  }
};
export {
  SHOP_BONUS_CREDITS,
  SHOP_BONUS_DAILY_CAP,
  handler
};
