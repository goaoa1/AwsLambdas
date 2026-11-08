// ========================================
// claimDevice.ts - POST /claim-device { DeviceId }
//   로그인 직후 앱이 부른다. 이 기기를 이 계정의 '현재 기기'로 적는다.
//   예전 기기는 다음 요청(또는 30초마다의 확인)에서 409 SignedInElsewhere 를 받고 로그인 화면으로 간다.
//   예전 기기에서 풀던 퀴즈가 있으면 시간이 계속 흐르지 않게 일시정지해 둔다.
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { getActiveSession, pauseSession } from 'quiz-utils/sessionManager';
import { DEVICE_TABLE, getSub } from './deviceGuard';

const client = new DynamoDBClient({ region: process.env.REGION });
const DEVICE_RE = /^[A-Za-z0-9-]{8,64}$/;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = getSub(event);
  if (!userId) return createErrorResponse(401, 'Unauthorized');

  let deviceId = '';
  try {
    deviceId = String(JSON.parse(event.body || '{}').DeviceId ?? '').trim();
  } catch {
    /* 아래에서 거절 */
  }
  if (!DEVICE_RE.test(deviceId)) {
    return createErrorResponse(400, 'Invalid DeviceId', { Reason: 'InvalidDeviceId' });
  }

  const now = new Date().toISOString();
  await client.send(
    new PutItemCommand({
      TableName: DEVICE_TABLE,
      Item: { PlayerID: { S: userId }, DeviceId: { S: deviceId }, ClaimedAt: { S: now } },
    })
  );

  // 예전 기기의 퀴즈 시간이 흐르지 않게 (새 기기에서 이어 풀 수 있다)
  let pausedQuiz = false;
  try {
    const session = await getActiveSession(userId);
    if (session && !session.IsPaused) {
      await pauseSession(userId);
      pausedQuiz = true;
    }
  } catch (e) {
    console.error('[ClaimDevice] pausing the old session failed', e);
  }

  console.log(`[ClaimDevice] ${userId} -> ${deviceId} (pausedQuiz=${pausedQuiz})`);
  return createSuccessResponse({ DeviceId: deviceId, ClaimedAt: now, PausedQuiz: pausedQuiz });
};
