// ========================================
// checkDevice.ts - GET /check-device (헤더 X-Device-Id)
//   앱이 30초마다, 그리고 앱으로 돌아올 때 부른다. 다른 기기에서 로그인했으면 409 SignedInElsewhere.
//   (검사 자체는 wrap-device-guard 가 앞에 붙이는 것과 같은 deviceGuard 로 한다)
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { checkDevice, getSub, getDeviceHeader } from './deviceGuard';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (!getSub(event)) {
    return { statusCode: 401, body: JSON.stringify({ Success: false, Message: 'Unauthorized' }) };
  }
  const blocked = await checkDevice(event);
  if (blocked) return blocked;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ Success: true, Data: { Active: true, HasDevice: !!getDeviceHeader(event) } }),
  };
};
