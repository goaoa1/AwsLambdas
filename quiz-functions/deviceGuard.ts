// ========================================
// deviceGuard.ts - 한 계정은 마지막으로 로그인한 기기 하나만 쓸 수 있게 한다
//
//   PlayerDevices (PK PlayerID): DeviceId, ClaimedAt
//   - 앱은 로그인 직후 ClaimDevice 로 새 기기 번호를 적고, 모든 요청에 X-Device-Id 헤더를 붙인다.
//   - 헤더의 번호가 적힌 번호와 다르면 409 { Error: { Reason: 'SignedInElsewhere' } } 를 돌려준다.
//   - 헤더가 없으면(예전 앱) 막지 않는다. DynamoDB 오류일 때도 막지 않는다 (게임이 멈추는 것보다 낫다).
//   이 파일은 quiz-utils 에 기대지 않는다. wrap-device-guard.mjs 가 다른 Lambda 앞에 끼워 넣기 때문.
// ========================================
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const DEVICE_TABLE = 'PlayerDevices';
export const DEVICE_HEADER = 'x-device-id';
export const SIGNED_IN_ELSEWHERE = 'SignedInElsewhere';

const client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });

export function getSub(event: APIGatewayProxyEvent): string | undefined {
  return event?.requestContext?.authorizer?.claims?.sub as string | undefined;
}

export function getDeviceHeader(event: APIGatewayProxyEvent): string | undefined {
  const headers = event?.headers ?? {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === DEVICE_HEADER && typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

export function signedInElsewhereResponse(): APIGatewayProxyResult {
  return {
    statusCode: 409,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      Success: false,
      Message: 'Signed in on another device',
      Error: { Reason: SIGNED_IN_ELSEWHERE },
      Timestamp: new Date().toISOString(),
    }),
  };
}

/** 막아야 하면 409 응답을, 지나가도 되면 null 을 돌려준다 */
export async function checkDevice(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult | null> {
  const sub = getSub(event);
  const device = getDeviceHeader(event);
  if (!sub || !device) return null;
  try {
    const r = await client.send(
      new GetItemCommand({
        TableName: DEVICE_TABLE,
        Key: { PlayerID: { S: sub } },
        ProjectionExpression: 'DeviceId',
      })
    );
    const current = r.Item?.DeviceId?.S;
    if (current && current !== device) {
      console.warn(`[deviceGuard] ${sub}: device ${device} is not the current one`);
      return signedInElsewhereResponse();
    }
  } catch (e) {
    console.error('[deviceGuard] check failed, letting the request through', e);
  }
  return null;
}
