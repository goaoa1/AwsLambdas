// ========================================
// guardEntry.ts - 이미 배포된 Lambda 앞에 기기 검사를 끼워 넣는 index.mjs (wrap-device-guard.mjs 가 사용)
//   원래 index.mjs / index.js 는 inner.mjs / inner.js 로 이름이 바뀌어 같은 zip 에 들어 있다.
//   build-device.mjs 가 이 파일의 './inner.mjs' 를 './inner.js' 로 바꾼 판도 만든다.
//
//   원래 코드는 반드시 정적 import 로 불러온다. 첫 요청에서 import() 로 불러오면 무거운 레이어
//   (quiz-utils → powertools/middy) 적재가 요청 시간에 들어가, 128MB·3초 함수는 시간 초과가 난다 (2026-11-08).
// ========================================
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import * as innerModule from './inner.mjs';
import { checkDevice } from './deviceGuard';

type Handler = (event: unknown, context: unknown, callback?: unknown) => unknown;
const mod = innerModule as unknown as { handler?: Handler; default?: { handler?: Handler } };
const inner: Handler | undefined = mod.handler ?? mod.default?.handler;

export const handler = async (event: APIGatewayProxyEvent, context: Context) => {
  const blocked = await checkDevice(event);
  if (blocked) return blocked;
  if (typeof inner !== 'function') throw new Error('inner handler not found');
  // 예전 콜백 방식 핸들러도 받아 준다
  return new Promise((resolve, reject) => {
    const callback = (err: unknown, result: unknown) => (err ? reject(err) : resolve(result));
    try {
      const r = inner(event, context, callback) as Promise<unknown> | undefined;
      if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
};
