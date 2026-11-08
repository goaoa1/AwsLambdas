// claimDailyAttendance.ts
import {
  IdempotencyType,
  validateIdempotencyKey,
  createErrorResponse,
  createSuccessResponse,
  createIdempotentHandler
} from "quiz-utils/idempotencyUtils";
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand2, UpdateItemCommand as UpdateItemCommand2 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall2, unmarshall as unmarshall2 } from "@aws-sdk/util-dynamodb";

// inventoryStore.ts
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

// itemCatalog.ts
var MAX_ITEM_COUNT = 99;
var ITEMS = [
  { ItemId: "Item_StaminaS", Name: "\uC791\uC740 \uBB3C\uC57D", Desc: "\uC2A4\uD0DC\uBBF8\uB098 +1", Stamina: 1, Price: 30 },
  { ItemId: "Item_StaminaL", Name: "\uD070 \uBB3C\uC57D", Desc: "\uC2A4\uD0DC\uBBF8\uB098 +3", Stamina: 3, Price: 80 },
  { ItemId: "Item_StaminaFull", Name: "\uAC00\uB4DD \uCC44\uC6B0\uAE30", Desc: "\uC2A4\uD0DC\uBBF8\uB098\uB97C 10\uAE4C\uC9C0", Stamina: "Full", Price: 200 }
];
function findItem(id) {
  return id ? ITEMS.find((i) => i.ItemId === id) : void 0;
}
var ITEM_NAME = (id) => findItem(id)?.Name ?? id;

// giftRules.ts
var REGEN_INTERVAL_MS = 10 * 60 * 1e3;

// inventoryStore.ts
var PLAYER_TABLE = "PlayerResources";
var client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });
async function ensureItemsMap(playerId) {
  try {
    await client.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: playerId }),
        UpdateExpression: "SET #items = if_not_exists(#items, :empty)",
        ConditionExpression: "attribute_exists(PlayerID)",
        ExpressionAttributeNames: { "#items": "Items" },
        ExpressionAttributeValues: marshall({ ":empty": {} })
      })
    );
  } catch (e) {
    if (e.name !== "ConditionalCheckFailedException") throw e;
  }
}
function grantItemsExpression(grants, current, prefix = "g") {
  const sets = [];
  const conds = [];
  const names = { "#items": "Items" };
  const values = {};
  const granted = {};
  let i = 0;
  for (const [itemId, n] of Object.entries(grants)) {
    if (!n || n <= 0) continue;
    const cur = current[itemId] ?? 0;
    const next = Math.min(MAX_ITEM_COUNT, cur + n);
    granted[itemId] = next - cur;
    names[`#${prefix}${i}`] = itemId;
    values[`:${prefix}${i}`] = next;
    sets.push(`#items.#${prefix}${i} = :${prefix}${i}`);
    values[`:${prefix}c${i}`] = cur;
    conds.push(`(attribute_not_exists(#items.#${prefix}${i}) OR #items.#${prefix}${i} = :${prefix}c${i})`);
    i++;
  }
  if (!sets.length) delete names["#items"];
  return { sets, conds, names, values, granted };
}

// claimDailyAttendance.ts
var dynamoDBClient = new DynamoDBClient2({ region: process.env.REGION });
var PLAYER_TABLE2 = "PlayerResources";
var MAX_STAMINA2 = 10;
function getKSTDateString(offsetDays = 0) {
  const kstOffsetMs = 9 * 60 * 60 * 1e3;
  const dayOffsetMs = offsetDays * 24 * 60 * 60 * 1e3;
  return new Date(Date.now() + kstOffsetMs + dayOffsetMs).toISOString().slice(0, 10);
}
function calcBonusItems(streak) {
  if (streak % 7 === 0) return { Item_StaminaL: 1 };
  if (streak % 7 === 3) return { Item_StaminaS: 1 };
  return {};
}
function calcReward(streak) {
  if (streak % 7 === 0) return 5;
  if (streak % 3 === 0) return 2;
  return 1;
}
var lambdaHandler = async (event, _context) => {
  console.log("[ClaimDailyAttendance] Lambda invoked");
  const validation = validateIdempotencyKey(event, IdempotencyType.ATTENDANCE_CHECK);
  if (!validation.isValid) {
    return createErrorResponse(400, validation.error);
  }
  const userId = validation.userId;
  const todayKST = getKSTDateString(0);
  const yesterdayKST = getKSTDateString(-1);
  await ensureItemsMap(userId);
  const getResult = await dynamoDBClient.send(
    new GetItemCommand2({
      TableName: PLAYER_TABLE2,
      Key: marshall2({ PlayerID: userId })
    })
  );
  if (!getResult.Item) {
    return createErrorResponse(404, "Player not found");
  }
  const playerData = unmarshall2(getResult.Item);
  const lastAttendanceDate = playerData.LastAttendanceDate;
  const currentStreak = playerData.AttendanceStreak ?? 0;
  const currentTotal = playerData.TotalAttendanceDays ?? 0;
  const currentStamina = playerData.Stamina ?? 0;
  if (lastAttendanceDate === todayKST) {
    return createErrorResponse(409, "Already claimed today");
  }
  const newStreak = lastAttendanceDate === yesterdayKST ? currentStreak + 1 : 1;
  const newTotal = currentTotal + 1;
  const reward = calcReward(newStreak);
  const newStamina = Math.min(currentStamina + reward, MAX_STAMINA2);
  const isFull = newStamina >= MAX_STAMINA2;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const currentItems = {};
  for (const [k, v] of Object.entries(playerData.Items ?? {})) currentItems[k] = Number(v) || 0;
  const bonus = grantItemsExpression(calcBonusItems(newStreak), currentItems, "b");
  const baseSet = "SET LastAttendanceDate = :today, AttendanceStreak = :newStreak, TotalAttendanceDays = :newTotal, Stamina = :newStamina, UpdatedAt = :now" + (bonus.sets.length ? ", " + bonus.sets.join(", ") : "");
  const updateExpression = isFull ? baseSet + " REMOVE LastStaminaUpdateAt" : baseSet;
  try {
    await dynamoDBClient.send(
      new UpdateItemCommand2({
        TableName: PLAYER_TABLE2,
        Key: marshall2({ PlayerID: userId }),
        UpdateExpression: updateExpression,
        ConditionExpression: "(attribute_not_exists(LastAttendanceDate) OR LastAttendanceDate <> :today)" + (bonus.conds.length ? " AND " + bonus.conds.join(" AND ") : ""),
        ...Object.keys(bonus.names).length ? { ExpressionAttributeNames: bonus.names } : {},
        ExpressionAttributeValues: marshall2({
          ":today": todayKST,
          ":newStreak": newStreak,
          ":newTotal": newTotal,
          ":newStamina": newStamina,
          ":now": now,
          ...bonus.values
        })
      })
    );
  } catch (error) {
    const err = error;
    if (err.name === "ConditionalCheckFailedException") {
      return createErrorResponse(409, "Already claimed today");
    }
    console.error("[ClaimDailyAttendance] Update error:", error);
    throw error;
  }
  console.log(
    `[ClaimDailyAttendance] Player ${userId} claimed. Reward: +${reward}, Streak: ${newStreak}, Total: ${newTotal}`
  );
  return createSuccessResponse({
    Reward: reward,
    NewStreak: newStreak,
    TotalDays: newTotal,
    UpdatedStamina: newStamina,
    // 보너스 아이템 [{ ItemId, Name, Count }]
    BonusItems: Object.entries(bonus.granted).map(([ItemId, Count]) => ({ ItemId, Name: ITEM_NAME(ItemId), Count }))
  });
};
var handler = createIdempotentHandler(lambdaHandler, IdempotencyType.ATTENDANCE_CHECK);
export {
  handler
};
