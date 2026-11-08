// getInventory.ts
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

// inventoryStore.ts
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand3, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall3, unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";

// itemCatalog.ts
var MAX_ITEM_COUNT = 99;
var ITEMS = [
  { ItemId: "Item_StaminaS", Name: "\uC791\uC740 \uBB3C\uC57D", Desc: "\uC2A4\uD0DC\uBBF8\uB098 +1", Stamina: 1, Price: 30 },
  { ItemId: "Item_StaminaL", Name: "\uD070 \uBB3C\uC57D", Desc: "\uC2A4\uD0DC\uBBF8\uB098 +3", Stamina: 3, Price: 80 },
  { ItemId: "Item_StaminaFull", Name: "\uAC00\uB4DD \uCC44\uC6B0\uAE30", Desc: "\uC2A4\uD0DC\uBBF8\uB098\uB97C 10\uAE4C\uC9C0", Stamina: "Full", Price: 200 }
];

// giftRules.ts
var MAX_STAMINA = 10;
var REGEN_INTERVAL_MS = 10 * 60 * 1e3;
function effectiveStamina(stored, lastUpdateAt, nowMs = Date.now()) {
  if (stored >= MAX_STAMINA || lastUpdateAt == null) return { stamina: Math.min(stored, MAX_STAMINA), clock: lastUpdateAt };
  const regen = Math.floor((nowMs - lastUpdateAt) / REGEN_INTERVAL_MS);
  if (regen <= 0) return { stamina: stored, clock: lastUpdateAt };
  const stamina = Math.min(stored + regen, MAX_STAMINA);
  return { stamina, clock: stamina >= MAX_STAMINA ? void 0 : lastUpdateAt + regen * REGEN_INTERVAL_MS };
}

// inventoryStore.ts
var PLAYER_TABLE = "PlayerResources";
var client = new DynamoDBClient2({ region: process.env.REGION || process.env.AWS_REGION });
async function readPlayerItems(playerId, nowMs = Date.now()) {
  const r = await client.send(
    new GetItemCommand3({
      TableName: PLAYER_TABLE,
      Key: marshall3({ PlayerID: playerId }),
      ProjectionExpression: "PlayerID, #items, Credits, Stamina, LastStaminaUpdateAt",
      ExpressionAttributeNames: { "#items": "Items" }
      // Items 는 DynamoDB 예약어
    })
  );
  const p = r.Item ? unmarshall3(r.Item) : {};
  const stored = Number(p.Stamina) || 0;
  const eff = effectiveStamina(stored, p.LastStaminaUpdateAt, nowMs);
  const items = {};
  for (const [k, v] of Object.entries(p.Items ?? {})) items[k] = Number(v) || 0;
  return { Items: items, Credits: Number(p.Credits) || 0, StoredStamina: stored, Stamina: eff.stamina, Clock: eff.clock, Exists: !!r.Item };
}
function toClientInventory(row) {
  return {
    Items: ITEMS.map((i) => ({
      ItemId: i.ItemId,
      Name: i.Name,
      Desc: i.Desc,
      Stamina: i.Stamina === "Full" ? MAX_STAMINA : i.Stamina,
      bFull: i.Stamina === "Full",
      Price: i.Price,
      Count: row.Items[i.ItemId] ?? 0
    })),
    Credits: row.Credits,
    Stamina: row.Stamina,
    MaxStamina: MAX_STAMINA,
    MaxItemCount: MAX_ITEM_COUNT
  };
}

// getInventory.ts
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  try {
    const row = await readPlayerItems(me);
    if (!row.Exists) return createErrorResponse(404, "Player not found", { Reason: "NoPlayer" });
    return createSuccessResponse(toClientInventory(row));
  } catch (e) {
    console.error("[GetInventory]", e);
    return createErrorResponse(500, "Failed to load inventory");
  }
};
export {
  handler
};
