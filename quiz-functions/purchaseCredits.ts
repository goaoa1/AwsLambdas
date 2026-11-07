// ========================================
// purchaseCredits.ts - 현금 결제(Google Play 인앱 상품) 영수증을 검증하고 크레딧 지급
//   POST /purchase-credits  { ProductId, PurchaseToken, Platform }
//     Platform: 'google'  → Google Play Developer API 로 purchaseToken 검증
//               'sandbox' → 환경 변수 ALLOW_SANDBOX_PURCHASE=true 일 때만 허용 (에디터/개발 빌드용)
//   헤더 X-Idempotency-Key / X-Idempotency-Timestamp 필요 (PAYMENT_VERIFY, 30일)
//
//   같은 purchaseToken 을 다른 멱등 키로 다시 보내도 지급되지 않도록 PurchaseReceipts 테이블에
//   토큰을 조건부로 기록한다 (PK: PurchaseToken).
//
//   환경 변수:
//     REGION, IDEMPOTENCY_TABLE, RECEIPT_TABLE(기본 PurchaseReceipts)
//     GOOGLE_PACKAGE_NAME            예: com.yourcompany.timestable
//     GOOGLE_SA_EMAIL                서비스 계정 이메일 (Play Console 에 연결, '재무 데이터 보기' 권한)
//     GOOGLE_SA_PRIVATE_KEY          서비스 계정 PEM 개인 키 (줄바꿈은 \n 으로)
//     ALLOW_SANDBOX_PURCHASE         'true' 면 Platform 'sandbox' 허용 (운영 스테이지에서는 비워 둘 것)
// ========================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  IdempotencyType,
  validateIdempotencyKey,
  createErrorResponse,
  createSuccessResponse,
  createIdempotentHandler,
} from 'quiz-utils/idempotencyUtils';
import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createSign } from 'node:crypto';
import { findCreditPack, SANDBOX_MAX_CREDITS } from './shopCatalog';
import { readShopState } from './shopState';

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const PLAYER_TABLE = 'PlayerResources';
const RECEIPT_TABLE = process.env.RECEIPT_TABLE || 'PurchaseReceipts';

type Platform = 'google' | 'sandbox';

interface VerifiedPurchase {
  ok: boolean;
  reason?: string;
  orderId?: string;
}

// ----------------------------------------
// Google Play: 서비스 계정 JWT → access token → purchases.products.get
// ----------------------------------------
function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getGoogleAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SA_EMAIL;
  const key = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY not configured');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600,
    })
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(key));
  const assertion = `${header}.${claims}.${signature}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(`Google token request failed: ${response.status} ${await response.text()}`);
  }
  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error('Google token response had no access_token');
  }
  return json.access_token;
}

async function verifyGooglePurchase(productId: string, purchaseToken: string): Promise<VerifiedPurchase> {
  const packageName = process.env.GOOGLE_PACKAGE_NAME;
  if (!packageName) {
    return { ok: false, reason: 'GOOGLE_PACKAGE_NAME not configured' };
  }

  const accessToken = await getGoogleAccessToken();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}` +
    `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;

  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 404 || response.status === 400) {
    return { ok: false, reason: `Google rejected token (${response.status})` };
  }
  if (!response.ok) {
    throw new Error(`Google purchase lookup failed: ${response.status} ${await response.text()}`);
  }

  const purchase = (await response.json()) as {
    purchaseState?: number;      // 0 구매 완료, 1 취소, 2 보류
    consumptionState?: number;   // 0 미소비, 1 소비됨
    orderId?: string;
    productId?: string;
  };

  if (purchase.purchaseState !== 0) {
    return { ok: false, reason: `purchaseState=${purchase.purchaseState}` };
  }
  if (purchase.productId && purchase.productId !== productId) {
    return { ok: false, reason: 'productId mismatch' };
  }
  return { ok: true, orderId: purchase.orderId };
}

// ----------------------------------------
// Lambda
// ----------------------------------------
const lambdaHandler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('[PurchaseCredits] Lambda invoked');

  const validation = validateIdempotencyKey(event, IdempotencyType.PAYMENT_VERIFY);
  if (!validation.isValid) {
    return createErrorResponse(400, validation.error!);
  }
  const userId = validation.userId!;

  let productId: unknown;
  let purchaseToken: unknown;
  let platform: unknown;
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    productId = body.ProductId;
    purchaseToken = body.PurchaseToken;
    platform = body.Platform ?? 'google';
  } catch {
    return createErrorResponse(400, 'Invalid request body');
  }

  if (typeof productId !== 'string' || productId.length === 0) {
    return createErrorResponse(400, 'ProductId is required');
  }
  if (typeof purchaseToken !== 'string' || purchaseToken.length === 0 || purchaseToken.length > 4096) {
    return createErrorResponse(400, 'PurchaseToken is required');
  }
  if (platform !== 'google' && platform !== 'sandbox') {
    return createErrorResponse(400, 'Unsupported platform');
  }

  const pack = findCreditPack(productId);
  if (!pack) {
    return createErrorResponse(404, 'Unknown product');
  }
  if (pack.Credits > SANDBOX_MAX_CREDITS && platform === 'sandbox') {
    return createErrorResponse(400, 'Pack too large for sandbox');
  }

  // 1. 영수증 검증
  let verified: VerifiedPurchase;
  if ((platform as Platform) === 'sandbox') {
    if (process.env.ALLOW_SANDBOX_PURCHASE !== 'true') {
      return createErrorResponse(403, 'Sandbox purchases are disabled');
    }
    verified = { ok: true, orderId: `sandbox-${purchaseToken.slice(0, 32)}` };
  } else {
    verified = await verifyGooglePurchase(productId, purchaseToken);
  }
  if (!verified.ok) {
    console.warn(`[PurchaseCredits] Verification failed for ${userId}: ${verified.reason}`);
    return createErrorResponse(402, 'Purchase could not be verified', { Reason: verified.reason });
  }

  // 2. 영수증(토큰) 재사용 차단 — 처음 보는 토큰만 통과
  const now = new Date().toISOString();
  try {
    await dynamoDBClient.send(
      new PutItemCommand({
        TableName: RECEIPT_TABLE,
        Item: marshall({
          PurchaseToken: `${platform}:${purchaseToken}`,
          PlayerID: userId,
          ProductId: productId,
          Credits: pack.Credits,
          OrderId: verified.orderId ?? '',
          CreatedAt: now,
        }),
        ConditionExpression: 'attribute_not_exists(PurchaseToken)',
      })
    );
  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return createErrorResponse(409, 'Purchase token already used', { Reason: 'TokenReused' });
    }
    console.error('[PurchaseCredits] Receipt write error:', error);
    throw error;
  }

  // 3. 크레딧 지급
  const result = await dynamoDBClient.send(
    new UpdateItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: userId }),
      UpdateExpression: 'SET Credits = if_not_exists(Credits, :zero) + :credits, UpdatedAt = :now',
      ExpressionAttributeValues: marshall({ ':zero': 0, ':credits': pack.Credits, ':now': now }),
      ReturnValues: 'ALL_NEW',
    })
  );
  const state = readShopState(unmarshall(result.Attributes!));

  console.log(`[PurchaseCredits] Player ${userId} +${pack.Credits} (${productId}, ${platform}) → ${state.Credits}`);

  return createSuccessResponse({
    ProductId: productId,
    GrantedCredits: pack.Credits,
    Credits: state.Credits,
    OrderId: verified.orderId ?? '',
  });
};

export const handler = createIdempotentHandler(lambdaHandler, IdempotencyType.PAYMENT_VERIFY);
