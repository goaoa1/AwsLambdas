// ========================================
// startBattle.ts - POST /start-battle (전투 판 입장, 전투 개편 S7a, 2026-11-24)
//   사용자: "전투 입장 로직부터 짜자"
//   요청 { QuizID: "1"~"9", Difficulty?: easy|normal|hard|veryhard, RequestId: 기기가 입장마다 만든 uuid }
//   → 200 { Battle: { BattleId, QuizID, Difficulty, CharacterId, StartedAt, StartedAtMs, Cost },
//           Stamina, MaxStamina, LastStaminaUpdateAt, NextStaminaAt, Replayed }
//   → 409 { Reason: 'NoStamina', Stamina, MaxStamina, NextStaminaAt }  (스태미나 모자람 — 기기는 물약 창을 연다)
//   → 409 { Reason: 'Busy' }  (같은 때 다른 요청이 스태미나를 계속 바꿈 — 드묾)
//   → 400 잘못된 요청 / 404 플레이어 없음
//   스태미나를 쓰고 판을 적는 일은 UpdateItem 하나 (조건: 읽은 스태미나 · 회복 시계가 그대로일 때만, 아니면 다시 읽어 계산).
//   같은 RequestId 로 다시 오면(응답을 못 받아 다시 시도) 새로 쓰지 않고 그 판을 돌려준다 — 스태미나를 두 번 쓰지 않음.
//   교실 판(startQuizSession.ts · ActiveQuizSessions · 이어하기)은 건드리지 않는다.
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import {
  BATTLE_STAMINA_COST,
  MAX_STAMINA,
  REGEN_INTERVAL_MS,
  parseStartRequest,
  planStamina,
  type BattleSession,
} from './battleRules';

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const PLAYER_TABLE = 'PlayerResources';
const TRIES = 4;

function getUserId(event: APIGatewayProxyEvent): string | undefined {
  return event.requestContext?.authorizer?.claims?.sub as string | undefined;
}

function isConditionFailure(e: unknown): boolean {
  return (e as { name?: string })?.name === 'ConditionalCheckFailedException';
}

function publicBattle(b: BattleSession) {
  return {
    BattleId: b.BattleId,
    QuizID: b.QuizID,
    Difficulty: b.Difficulty,
    CharacterId: b.CharacterId ?? null,
    StartedAt: b.StartedAt,
    StartedAtMs: b.StartedAtMs,
    Cost: b.Cost,
  };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, 'Unauthorized');

  let body: unknown;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return createErrorResponse(400, 'Bad JSON', { Reason: 'BadRequest' });
  }
  const req = parseStartRequest(body);
  if (typeof req === 'string') return createErrorResponse(400, req, { Reason: 'BadRequest' });

  try {
    for (let attempt = 0; attempt < TRIES; attempt++) {
      const res = await dynamoDBClient.send(
        new GetItemCommand({
          TableName: PLAYER_TABLE,
          Key: marshall({ PlayerID: me }),
          ProjectionExpression: 'PlayerID, Stamina, LastStaminaUpdateAt, SelectedCharacterId, BattleSession',
          ConsistentRead: true,
        })
      );
      if (!res.Item) return createErrorResponse(404, 'Player not found', { Reason: 'NoPlayer' });
      const player = unmarshall(res.Item) as {
        Stamina?: number;
        LastStaminaUpdateAt?: number;
        SelectedCharacterId?: string;
        BattleSession?: BattleSession;
      };
      const nowMs = Date.now();
      const stored = player.Stamina === undefined ? MAX_STAMINA : Number(player.Stamina);
      const lastClock = player.LastStaminaUpdateAt === undefined ? undefined : Number(player.LastStaminaUpdateAt);

      // 같은 입장 요청을 다시 받음 → 그 판 그대로 (스태미나는 이미 썼다)
      const prev = player.BattleSession;
      if (prev && prev.RequestId === req.requestId) {
        const plan = planStamina(stored, lastClock, nowMs, 0);
        console.log(`[StartBattle] ${me} replay ${prev.BattleId} (request ${req.requestId}) stamina ${plan.before}`);
        return createSuccessResponse({
          Battle: publicBattle(prev),
          Stamina: plan.before,
          MaxStamina: MAX_STAMINA,
          LastStaminaUpdateAt: plan.clock ?? null,
          NextStaminaAt: plan.clock !== undefined ? plan.clock + REGEN_INTERVAL_MS : null,
          Replayed: true,
        });
      }

      const plan = planStamina(stored, lastClock, nowMs, BATTLE_STAMINA_COST);
      if (!plan.ok) {
        console.log(`[StartBattle] ${me} no stamina (${plan.before})`);
        return createErrorResponse(409, 'Insufficient stamina', {
          Reason: 'NoStamina',
          Stamina: plan.before,
          MaxStamina: MAX_STAMINA,
          NextStaminaAt: plan.nextAt ?? null,
        });
      }

      const now = new Date(nowMs).toISOString();
      const battle: BattleSession = {
        BattleId: randomUUID(),
        RequestId: req.requestId,
        QuizID: req.quizId,
        Difficulty: req.difficulty,
        ...(player.SelectedCharacterId ? { CharacterId: player.SelectedCharacterId } : {}),
        StartedAt: now,
        StartedAtMs: nowMs,
        Status: 'Active',
        Cost: BATTLE_STAMINA_COST,
      };

      // 읽은 뒤 다른 요청(물약 · 선물 · 교실 판 시작 · 회복 저장)이 스태미나를 바꿨으면 실패 → 다시 읽어 계산
      const values: Record<string, unknown> = { ':s': plan.after, ':now': now, ':b': battle };
      const conds = ['attribute_exists(PlayerID)'];
      if (player.Stamina === undefined) conds.push('attribute_not_exists(Stamina)');
      else {
        conds.push('Stamina = :old');
        values[':old'] = player.Stamina;
      }
      if (player.LastStaminaUpdateAt === undefined) conds.push('attribute_not_exists(LastStaminaUpdateAt)');
      else {
        conds.push('LastStaminaUpdateAt = :oldClock');
        values[':oldClock'] = player.LastStaminaUpdateAt;
      }
      let update = 'SET Stamina = :s, UpdatedAt = :now, BattleSession = :b';
      if (plan.clock !== undefined) {
        update += ', LastStaminaUpdateAt = :clock';
        values[':clock'] = plan.clock;
      } else {
        update += ' REMOVE LastStaminaUpdateAt';
      }
      try {
        await dynamoDBClient.send(
          new UpdateItemCommand({
            TableName: PLAYER_TABLE,
            Key: marshall({ PlayerID: me }),
            UpdateExpression: update,
            ConditionExpression: conds.join(' AND '),
            ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true }),
          })
        );
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
        console.log(`[StartBattle] ${me} stamina changed while starting - retry ${attempt + 1}`);
        continue;
      }

      console.log(
        `[StartBattle] ${me} battle ${battle.BattleId} quiz ${battle.QuizID} ${battle.Difficulty} char ${battle.CharacterId ?? '-'} stamina ${plan.before} -> ${plan.after}`
      );
      return createSuccessResponse({
        Battle: publicBattle(battle),
        Stamina: plan.after,
        MaxStamina: MAX_STAMINA,
        LastStaminaUpdateAt: plan.clock ?? null,
        NextStaminaAt: plan.nextAt ?? null,
        Replayed: false,
      });
    }
    return createErrorResponse(409, 'Busy', { Reason: 'Busy' });
  } catch (e) {
    console.error('[StartBattle] error', e);
    return createErrorResponse(500, 'Battle start error', { Reason: 'ServerError' });
  }
};
