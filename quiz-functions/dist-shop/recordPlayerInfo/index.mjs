// recordPlayerInfo.ts
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
var dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
var PLAYER_TABLE = "PlayerResources";
var INITIAL_STAMINA = 10;
var MAX_STAMINA = 10;
var REGEN_INTERVAL_MS = 10 * 60 * 1e3;
function getKSTDateString(offsetDays = 0) {
  const kstOffsetMs = 9 * 60 * 60 * 1e3;
  const dayOffsetMs = offsetDays * 24 * 60 * 60 * 1e3;
  return new Date(Date.now() + kstOffsetMs + dayOffsetMs).toISOString().slice(0, 10);
}
function calcAttendanceReward(streak) {
  if (streak % 7 === 0) return 5;
  if (streak % 3 === 0) return 2;
  return 1;
}
var handler = async (event, _context) => {
  console.log("[RecordPlayerInfo] Lambda invoked");
  const userId = event.requestContext?.authorizer?.claims?.sub;
  if (!userId) {
    return createErrorResponse(401, "Unauthorized");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const nowMs = Date.now();
  const upsertResult = await dynamoDBClient.send(
    new UpdateItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      UpdateExpression: `
        SET Stamina   = if_not_exists(Stamina,   :initStamina),
            CreatedAt = if_not_exists(CreatedAt, :now),
            UpdatedAt = :now
      `,
      ExpressionAttributeValues: marshall({
        ":initStamina": INITIAL_STAMINA,
        ":now": now
      }),
      ReturnValues: "ALL_NEW"
    })
  );
  const playerData = unmarshall(upsertResult.Attributes);
  let stamina = playerData.Stamina;
  let lastStaminaUpdateAt = playerData.LastStaminaUpdateAt;
  if (stamina < MAX_STAMINA && lastStaminaUpdateAt != null) {
    const elapsed = nowMs - lastStaminaUpdateAt;
    const regenCount = Math.floor(elapsed / REGEN_INTERVAL_MS);
    if (regenCount > 0) {
      const newStamina = Math.min(stamina + regenCount, MAX_STAMINA);
      const advancedLastUpdate = lastStaminaUpdateAt + regenCount * REGEN_INTERVAL_MS;
      if (newStamina >= MAX_STAMINA) {
        await dynamoDBClient.send(
          new UpdateItemCommand({
            TableName: PLAYER_TABLE,
            Key: marshall({ PlayerID: userId }),
            UpdateExpression: "SET Stamina = :stamina, UpdatedAt = :now REMOVE LastStaminaUpdateAt",
            ExpressionAttributeValues: marshall({ ":stamina": newStamina, ":now": now })
          })
        );
        lastStaminaUpdateAt = void 0;
      } else {
        await dynamoDBClient.send(
          new UpdateItemCommand({
            TableName: PLAYER_TABLE,
            Key: marshall({ PlayerID: userId }),
            UpdateExpression: "SET Stamina = :stamina, LastStaminaUpdateAt = :lastUpdate, UpdatedAt = :now",
            ExpressionAttributeValues: marshall({
              ":stamina": newStamina,
              ":lastUpdate": advancedLastUpdate,
              ":now": now
            })
          })
        );
        lastStaminaUpdateAt = advancedLastUpdate;
      }
      stamina = newStamina;
      console.log(`[RecordPlayerInfo] Regen: +${regenCount} \u2192 Stamina ${stamina}/${MAX_STAMINA}`);
    }
  }
  if (stamina < MAX_STAMINA && lastStaminaUpdateAt == null) {
    await dynamoDBClient.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key: marshall({ PlayerID: userId }),
        UpdateExpression: "SET LastStaminaUpdateAt = :nowMs, UpdatedAt = :now",
        ExpressionAttributeValues: marshall({ ":nowMs": nowMs, ":now": now })
      })
    );
    lastStaminaUpdateAt = nowMs;
    console.log(`[RecordPlayerInfo] Regen clock was missing \u2014 initialized to now`);
  }
  const nextRegenAt = stamina < MAX_STAMINA && lastStaminaUpdateAt != null ? new Date(lastStaminaUpdateAt + REGEN_INTERVAL_MS).toISOString() : "";
  const todayKST = getKSTDateString(0);
  const yesterdayKST = getKSTDateString(-1);
  const lastAttendanceDate = playerData.LastAttendanceDate;
  const attendanceStreak = playerData.AttendanceStreak ?? 0;
  const attendanceTotalDays = playerData.TotalAttendanceDays ?? 0;
  const claimedToday = lastAttendanceDate === todayKST;
  const potentialStreak = lastAttendanceDate === yesterdayKST ? attendanceStreak + 1 : 1;
  const nextReward = claimedToday ? 0 : calcAttendanceReward(potentialStreak);
  console.log(`[RecordPlayerInfo] Player ${userId} Stamina: ${stamina}/${MAX_STAMINA}, NextRegenAt: ${nextRegenAt}, Attendance: claimed=${claimedToday}, streak=${attendanceStreak}`);
  return createSuccessResponse({
    PlayerID: playerData.PlayerID,
    Stamina: stamina,
    MaxStamina: MAX_STAMINA,
    NextRegenAt: nextRegenAt,
    CreatedAt: playerData.CreatedAt,
    AttendanceClaimedToday: claimedToday,
    AttendanceStreak: attendanceStreak,
    AttendanceTotalDays: attendanceTotalDays,
    AttendanceNextReward: nextReward,
    UnlockedCharacters: playerData.UnlockedCharacters ?? [],
    SelectedCharacterId: playerData.SelectedCharacterId ?? "",
    // 상점: 로그인 직후 메뉴 상단에 크레딧을 보여 주고, 부스가 입힌 의상을 바로 알 수 있게 함께 내려준다
    Credits: typeof playerData.Credits === "number" ? playerData.Credits : 0,
    OwnedOutfits: Array.isArray(playerData.OwnedOutfits) ? playerData.OwnedOutfits : [],
    EquippedOutfits: playerData.EquippedOutfits && typeof playerData.EquippedOutfits === "object" ? playerData.EquippedOutfits : {}
  });
};
export {
  handler
};
