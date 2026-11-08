// guardEntry.guard-mjs.tmp.ts
import * as innerModule from "./inner.mjs";

// deviceGuard.ts
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
var DEVICE_TABLE = "PlayerDevices";
var DEVICE_HEADER = "x-device-id";
var SIGNED_IN_ELSEWHERE = "SignedInElsewhere";
var client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });
function getSub(event) {
  return event?.requestContext?.authorizer?.claims?.sub;
}
function getDeviceHeader(event) {
  const headers = event?.headers ?? {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === DEVICE_HEADER && typeof v === "string" && v.trim()) return v.trim();
  }
  return void 0;
}
function signedInElsewhereResponse() {
  return {
    statusCode: 409,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({
      Success: false,
      Message: "Signed in on another device",
      Error: { Reason: SIGNED_IN_ELSEWHERE },
      Timestamp: (/* @__PURE__ */ new Date()).toISOString()
    })
  };
}
async function checkDevice(event) {
  const sub = getSub(event);
  const device = getDeviceHeader(event);
  if (!sub || !device) return null;
  try {
    const r = await client.send(
      new GetItemCommand({
        TableName: DEVICE_TABLE,
        Key: { PlayerID: { S: sub } },
        ProjectionExpression: "DeviceId"
      })
    );
    const current = r.Item?.DeviceId?.S;
    if (current && current !== device) {
      console.warn(`[deviceGuard] ${sub}: device ${device} is not the current one`);
      return signedInElsewhereResponse();
    }
  } catch (e) {
    console.error("[deviceGuard] check failed, letting the request through", e);
  }
  return null;
}

// guardEntry.guard-mjs.tmp.ts
var mod = innerModule;
var inner = mod.handler ?? mod.default?.handler;
var handler = async (event, context) => {
  const blocked = await checkDevice(event);
  if (blocked) return blocked;
  if (typeof inner !== "function") throw new Error("inner handler not found");
  return new Promise((resolve, reject) => {
    const callback = (err, result) => err ? reject(err) : resolve(result);
    try {
      const r = inner(event, context, callback);
      if (r && typeof r.then === "function") r.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
};
export {
  handler
};
