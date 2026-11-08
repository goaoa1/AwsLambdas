// claimDevice.ts
import { DynamoDBClient as DynamoDBClient2, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";
import { getActiveSession, pauseSession } from "quiz-utils/sessionManager";

// deviceGuard.ts
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
var DEVICE_TABLE = "PlayerDevices";
var client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });
function getSub(event) {
  return event?.requestContext?.authorizer?.claims?.sub;
}

// claimDevice.ts
var client2 = new DynamoDBClient2({ region: process.env.REGION });
var DEVICE_RE = /^[A-Za-z0-9-]{8,64}$/;
var handler = async (event) => {
  const userId = getSub(event);
  if (!userId) return createErrorResponse(401, "Unauthorized");
  let deviceId = "";
  try {
    deviceId = String(JSON.parse(event.body || "{}").DeviceId ?? "").trim();
  } catch {
  }
  if (!DEVICE_RE.test(deviceId)) {
    return createErrorResponse(400, "Invalid DeviceId", { Reason: "InvalidDeviceId" });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await client2.send(
    new PutItemCommand({
      TableName: DEVICE_TABLE,
      Item: { PlayerID: { S: userId }, DeviceId: { S: deviceId }, ClaimedAt: { S: now } }
    })
  );
  let pausedQuiz = false;
  try {
    const session = await getActiveSession(userId);
    if (session && !session.IsPaused) {
      await pauseSession(userId);
      pausedQuiz = true;
    }
  } catch (e) {
    console.error("[ClaimDevice] pausing the old session failed", e);
  }
  console.log(`[ClaimDevice] ${userId} -> ${deviceId} (pausedQuiz=${pausedQuiz})`);
  return createSuccessResponse({ DeviceId: deviceId, ClaimedAt: now, PausedQuiz: pausedQuiz });
};
export {
  handler
};
