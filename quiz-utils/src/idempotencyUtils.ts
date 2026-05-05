// ========================================
// idempotencyUtils.ts - 멱등성 공통 유틸리티
// ========================================

import { IdempotencyConfig } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';
import { makeHandlerIdempotent } from '@aws-lambda-powertools/idempotency/middleware';
import middy from '@middy/core';
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

type LambdaHandler = (
  event: APIGatewayProxyEvent,
  context: Context
) => Promise<APIGatewayProxyResult>;

// ========================================
// 멱등성 타입 정의
// ========================================
export enum IdempotencyType {
  STAMINA_DEDUCT = 'stamina_deduct',
  SESSION_START = 'session_start',
  CURRENCY_USE = 'currency_use',
  ITEM_PURCHASE = 'item_purchase',
  REWARD_CLAIM = 'reward_claim',
  RANKING_SUBMIT = 'ranking_submit',
  PAYMENT_VERIFY = 'payment_verify',
  ATTENDANCE_CHECK = 'attendance_check',
  QUEST_COMPLETE = 'quest_complete',
  ACHIEVEMENT_CLAIM = 'achievement_claim',
}

// ========================================
// 멱등성 설정 (타입별 TTL)
// ========================================
export const IDEMPOTENCY_CONFIG = {
  [IdempotencyType.STAMINA_DEDUCT]: {
    ttl: 3600,        // 1시간
    timeout: 300,     // 5분 (Replay Attack 방지)
  },
  [IdempotencyType.SESSION_START]: {
    ttl: 600,         // 10분 (네트워크 재시도 허용)
    timeout: 300,     // 5분 (Replay Attack 방지)
  },
  [IdempotencyType.CURRENCY_USE]: {
    ttl: 86400,       // 24시간
    timeout: 300,
  },
  [IdempotencyType.ITEM_PURCHASE]: {
    ttl: 86400,       // 24시간
    timeout: 300,
  },
  [IdempotencyType.REWARD_CLAIM]: {
    ttl: 2592000,     // 30일 (한 번만 받아야 함)
    timeout: 300,
  },
  [IdempotencyType.RANKING_SUBMIT]: {
    ttl: 86400,       // 24시간
    timeout: 60,
  },
  [IdempotencyType.PAYMENT_VERIFY]: {
    ttl: 2592000,     // 30일 (영수증 영구 검증)
    timeout: 300,
  },
  [IdempotencyType.ATTENDANCE_CHECK]: {
    ttl: 86400,       // 24시간 (하루 1번)
    timeout: 300,
  },
  [IdempotencyType.QUEST_COMPLETE]: {
    ttl: 2592000,     // 30일 (한 번만)
    timeout: 300,
  },
  [IdempotencyType.ACHIEVEMENT_CLAIM]: {
    ttl: 2592000,     // 30일 (한 번만)
    timeout: 300,
  },
};

// ========================================
// Persistence Layer 생성 (타입별)
// ========================================
export function createPersistenceLayer(type: IdempotencyType) {
  return new DynamoDBPersistenceLayer({
    tableName: process.env.IDEMPOTENCY_TABLE || 'IdempotencyTable',
    expiryAttr: 'expiration',
    statusAttr: 'status',
    dataAttr: 'data',
    validationKeyAttr: 'validation',
    staticPkValue: type,  // 타입별로 파티션 분리
  });
}

// ========================================
// Idempotency Config 생성
// ========================================
export function createIdempotencyConfig(type: IdempotencyType) {
  return new IdempotencyConfig({
    eventKeyJmesPath: 'headers."X-Idempotency-Key"',
    throwOnNoIdempotencyKey: true,
    expiresAfterSeconds: IDEMPOTENCY_CONFIG[type].ttl,
    useLocalCache: true,
    hashFunction: 'md5',
  });
}

// ========================================
// Idempotency Key 검증
// ========================================
export interface IdempotencyKeyValidation {
  isValid: boolean;
  error?: string;
  userId?: string;
  requestId?: string;
  timestamp?: number;
}

export function validateIdempotencyKey(
  event: APIGatewayProxyEvent,
  type: IdempotencyType
): IdempotencyKeyValidation {
  // 1. Key 존재 확인: {userId}_{requestId} (timestamp 별도 헤더)
  const idempotencyKey = event.headers?.['X-Idempotency-Key'] ??
                         event.headers?.['x-idempotency-key'];

  if (!idempotencyKey) {
    return { isValid: false, error: 'Missing X-Idempotency-Key header' };
  }

  // 2. Timestamp 헤더 확인 (Replay Attack 방지용)
  const timestampStr = event.headers?.['X-Idempotency-Timestamp'] ??
                       event.headers?.['x-idempotency-timestamp'];

  if (!timestampStr) {
    return { isValid: false, error: 'Missing X-Idempotency-Timestamp header' };
  }

  // 3. Key 형식 검증: {userId}_{requestId}
  //    Cognito sub와 UUID는 모두 하이픈만 포함 → 언더스코어로 분리하면 정확히 2개
  const parts = idempotencyKey.split('_');

  if (parts.length !== 2) {
    return {
      isValid: false,
      error: 'Invalid idempotency key format. Expected: userId_requestId',
    };
  }

  const userId = parts[0];
  const requestId = parts[1];

  // 4. UserId 검증 (JWT sub 일치)
  const cognitoUserId = event.requestContext?.authorizer?.claims?.sub as string | undefined;

  if (!cognitoUserId) {
    return { isValid: false, error: 'Unauthorized - No user ID in token' };
  }

  if (userId !== cognitoUserId) {
    return { isValid: false, error: 'Idempotency key userId does not match authenticated user' };
  }

  // 5. Timestamp 검증 (Replay Attack 방지)
  const timestamp = parseInt(timestampStr, 10);

  if (isNaN(timestamp)) {
    return { isValid: false, error: 'Invalid X-Idempotency-Timestamp header' };
  }

  const timeDiff = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (timeDiff > IDEMPOTENCY_CONFIG[type].timeout) {
    return { isValid: false, error: `Request expired. Max age: ${IDEMPOTENCY_CONFIG[type].timeout} seconds` };
  }

  // 6. RequestId 검증 (UUID 형식)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(requestId)) {
    return { isValid: false, error: 'Invalid requestId format. Must be UUID' };
  }

  return { isValid: true, userId, requestId, timestamp };
}

// ========================================
// 에러 응답 생성
// ========================================
export function createErrorResponse(statusCode: number, message: string, details?: unknown) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      Success: false,
      Message: message,
      Error: details,
      Timestamp: new Date().toISOString(),
    }),
  };
}

// ========================================
// 성공 응답 생성
// ========================================
export function createSuccessResponse(data: unknown) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      Success: true,
      Data: data,
      Timestamp: new Date().toISOString(),
    }),
  };
}

// ========================================
// 멱등성 Lambda 핸들러 생성 (middy 래핑 포함)
// 함수 파일에서 @aws-lambda-powertools를 직접 import할 필요 없음
// ========================================
export function createIdempotentHandler(handler: LambdaHandler, type: IdempotencyType) {
  return middy(handler).use(
    makeHandlerIdempotent({
      persistenceStore: createPersistenceLayer(type),
      config: createIdempotencyConfig(type),
    })
  );
}
