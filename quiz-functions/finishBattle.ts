// ========================================
// finishBattle.ts - POST /finish-battle (전투 판 끝, 전투 개편 S7b, 2026-11-24)
//   사용자: "이어서 쭉쭉 진행하자" (S7b — 정답률 · 기록 · 우유)
//   요청 { BattleId, Result: 'win'|'retreat', Seconds, Stats: { Damage, Kills, Recites, MaxChain, BestShot, Wrong, Releases, Level, Skills,
//          BossDown, Dodged, Taken }, Answers: [{ Q: 문제 번호, A: 친 답, Ms }], Pool: [이 권 · 난이도의 문제 번호] }
//   → 200 { Result, Graded: { Answers, Corrects }, Record, NewBest, Milk, Grimoire: { Cells, Learned, Total }, Suspicious, Replayed }
//   → 409 { Reason: 'NoBattle' }  (입장한 판이 없거나 다른 판 — 새 판에 덮였다)   400 잘못된 요청 · 404 플레이어 없음
//   하는 일 (start-battle 이 적은 PlayerResources.BattleSession 을 한 번만 마감):
//     1) 답을 교실 판과 같은 채점(gradeUserAnswer — S3 문제표)으로 다시 매긴다 — 기기의 '맞음'은 믿지 않는다
//     2) 마감 + 전투 기록(BattleRecords["<권>_<난이도>"] · BattleTotals — 교실 최고 기록과 따로)을 UpdateItem 하나로
//        (조건: 그 판이 아직 Active). 피해 · 답 수 · 시간이 맞힌 수로 낼 수 있는 범위를 넘으면 Suspicious — 판 수는 세고 최고 기록은 안 고침
//     3) 문제별 정답률(PlayerQuestionStats — 커리어 정답률 표)에 더한다
//     4) 의뢰 완료(win)면 판 끝 우유 1 (quizMilk.ts — 교실 판과 같은 하루 상한, Suspicious 면 없음)
//     5) 마도서 칸: Pool 의 문제마다 외웠는지(세 번 넘게 풀고 80% 넘게 맞힘) · 이번 판으로 새로 외운 식
//     + 의뢰 완료면 장비 · 스킬 책 보상 (gearRewards.ts — 2026-11-25 장비 · 스킬 G1, Docs/장비_스킬_계획.md §2-3) → Rewards [{ ItemId, Name, Kind, Count }]
//     + 도전과제 진행도 (PlayerStats — achievementStats.ts addFinishedBattle, 2026-11-24): 기존 도전과제 다섯 + 전투 4종
//   같은 BattleId 를 다시 받으면(응답을 못 받아 다시 보냄) 적어 둔 Summary 를 그대로 돌려준다 — 정답률 · 우유를 두 번 더하지 않는다.
// ========================================
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createErrorResponse, createSuccessResponse } from 'quiz-utils/idempotencyUtils';
import { gradeUserAnswer } from 'quiz-utils/gradingManager';
import { addCounts, readStats } from './questionStats';
import { addFinishedBattle } from './achievementStats';
import { grantQuizMilk } from './quizMilk';
import { grantBattleRewards, type RewardLine } from './gearRewards';
import { grimoire, parseFinishRequest, suspicious, updateRecord, type BattleRecord, type BattleSession } from './battleRules';

const dynamoDBClient = new DynamoDBClient({ region: process.env.REGION });
const PLAYER_TABLE = 'PlayerResources';

function getUserId(event: APIGatewayProxyEvent): string | undefined {
  return event.requestContext?.authorizer?.claims?.sub as string | undefined;
}

function isConditionFailure(e: unknown): boolean {
  return (e as { name?: string })?.name === 'ConditionalCheckFailedException';
}

async function readPlayer(me: string) {
  const res = await dynamoDBClient.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: me }),
      ProjectionExpression: 'PlayerID, BattleSession, BattleRecords, BattleTotals',
      ConsistentRead: true,
    })
  );
  return res.Item
    ? (unmarshall(res.Item) as {
        BattleSession?: BattleSession;
        BattleRecords?: Record<string, Partial<BattleRecord>>;
        BattleTotals?: Record<string, number>;
      })
    : undefined;
}

async function grimoireFor(me: string, pool: string[], added: Record<string, { A: number; C: number }>) {
  if (pool.length === 0) return null;
  try {
    return grimoire(pool, await readStats(me), added);
  } catch (e) {
    console.error('[FinishBattle] grimoire read failed', e);
    return null;
  }
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
  const req = parseFinishRequest(body);
  if (typeof req === 'string') return createErrorResponse(400, req, { Reason: 'BadRequest' });

  try {
    const player = await readPlayer(me);
    if (!player) return createErrorResponse(404, 'Player not found', { Reason: 'NoPlayer' });
    const battle = player.BattleSession;
    if (!battle || battle.BattleId !== req.battleId) {
      console.log(`[FinishBattle] ${me} battle ${req.battleId} not current (${battle?.BattleId ?? '-'})`);
      return createErrorResponse(409, 'Not the current battle', { Reason: 'NoBattle' });
    }
    if (battle.Status === 'Finished') {
      // 같은 끝을 다시 받음 — 적어 둔 결과 그대로 (정답률 · 우유는 이미 더함)
      console.log(`[FinishBattle] ${me} replay ${battle.BattleId}`);
      return createSuccessResponse({ ...(battle.Summary ?? {}), Grimoire: await grimoireFor(me, req.pool, {}), Replayed: true });
    }

    // 1) 다시 채점 — 문제마다 { 푼 수, 맞힌 수 }
    //   이 판에 나온 문제 자료를 먼저 한꺼번에 읽어 둔다 (getQuestionData 는 문제 번호마다 캐시 — 콜드 스타트에 답마다 차례로 S3 를 읽지 않게)
    const ids = [...new Set(req.answers.map((a) => a.q))];
    await Promise.all(ids.map((q) => gradeUserAnswer(q, '').catch(() => undefined)));
    const counts: Record<string, { A: number; C: number }> = {};
    let corrects = 0;
    let graded = 0;
    for (const ans of req.answers) {
      let correct = false;
      try {
        correct = !!(await gradeUserAnswer(ans.q, ans.a)).bIsCorrect;
      } catch {
        continue;   // 모르는 문제 번호 — 세지 않는다
      }
      const row = (counts[ans.q] ??= { A: 0, C: 0 });
      row.A += 1;
      row.C += correct ? 1 : 0;
      corrects += correct ? 1 : 0;
      graded += 1;
    }

    // 2) 마감 + 전투 기록 (한 번만)
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const why = suspicious(req, nowMs - Number(battle.StartedAtMs || nowMs), corrects);
    const key = `${battle.QuizID}_${battle.Difficulty}`;
    const records = { ...(player.BattleRecords ?? {}) };
    const { record, newBest } = updateRecord(records[key], req.win, req.stats, why.length === 0, now);
    records[key] = record;
    const t = player.BattleTotals ?? {};
    const totals = {
      Plays: Number(t.Plays ?? 0) + 1,
      Wins: Number(t.Wins ?? 0) + (req.win ? 1 : 0),
      Kills: Number(t.Kills ?? 0) + req.stats.Kills,
      Damage: Number(t.Damage ?? 0) + req.stats.Damage,
      Answers: Number(t.Answers ?? 0) + graded,
      Corrects: Number(t.Corrects ?? 0) + corrects,
      Dodged: Number(t.Dodged ?? 0) + req.stats.Dodged,
    };
    const summary: Record<string, unknown> = {
      Result: req.win ? 'win' : 'retreat',
      Graded: { Answers: graded, Corrects: corrects },
      Record: { Key: key, ...record },
      NewBest: newBest,
      Milk: null,
      Rewards: [] as RewardLine[],
      Suspicious: why,
    };
    try {
      await dynamoDBClient.send(
        new UpdateItemCommand({
          TableName: PLAYER_TABLE,
          Key: marshall({ PlayerID: me }),
          UpdateExpression:
            'SET BattleSession.#st = :fin, BattleSession.FinishedAt = :now, BattleSession.Summary = :sum, BattleRecords = :recs, BattleTotals = :tot, UpdatedAt = :now',
          ConditionExpression: 'attribute_exists(BattleSession) AND BattleSession.BattleId = :id AND BattleSession.#st = :active',
          ExpressionAttributeNames: { '#st': 'Status' },
          ExpressionAttributeValues: marshall(
            { ':fin': 'Finished', ':active': 'Active', ':now': now, ':sum': summary, ':recs': records, ':tot': totals, ':id': battle.BattleId },
            { removeUndefinedValues: true }
          ),
        })
      );
    } catch (e) {
      if (!isConditionFailure(e)) throw e;
      // 그 사이 다른 요청이 마감했거나 새 판이 들어옴 — 지금 값으로 다시 답한다
      const again = await readPlayer(me);
      const b2 = again?.BattleSession;
      if (b2 && b2.BattleId === req.battleId && b2.Status === 'Finished') {
        return createSuccessResponse({ ...(b2.Summary ?? {}), Grimoire: await grimoireFor(me, req.pool, {}), Replayed: true });
      }
      return createErrorResponse(409, 'Not the current battle', { Reason: 'NoBattle' });
    }

    // 3) 문제별 정답률 (커리어 정답률 표) — 실패해도 판 끝은 막지 않는다
    try {
      if (Object.keys(counts).length > 0) await addCounts(me, counts);
    } catch (e) {
      console.error('[FinishBattle] question stats failed', e);
    }

    // 3-2) 도전과제 진행도 (2026-11-24, 사용자: "기존 반영 + 전투 4종") — 맞힌 수로 낼 수 없는 판은 세지 않는다. 실패해도 판 끝은 막지 않는다
    let achievementsAdded = false;
    if (why.length === 0) {
      try {
        achievementsAdded = await addFinishedBattle({
          PlayerID: me,
          Win: req.win,
          QuizID: battle.QuizID,
          CharacterId: battle.CharacterId,
          Corrects: corrects,
          Wrong: graded - corrects,
          Kills: req.stats.Kills,
          Recites: req.stats.Recites,
          Interrupts: req.stats.Interrupts,
          Dodged: req.stats.Dodged,
        });
      } catch (e) {
        console.error('[FinishBattle] achievement stats failed', e);
      }
    }

    // 4) 의뢰 완료면 판 끝 우유 1 (교실 판과 같은 하루 상한) — 맞힌 수로 낼 수 없는 판(Suspicious)에는 주지 않는다
    if (req.win && why.length === 0) {
      try {
        const g = await grantQuizMilk(me);
        summary.Milk = { Gift: g.gift, Today: g.today, Cap: g.cap, Total: g.total };
        await dynamoDBClient
          .send(
            new UpdateItemCommand({
              TableName: PLAYER_TABLE,
              Key: marshall({ PlayerID: me }),
              UpdateExpression: 'SET BattleSession.Summary.Milk = :milk',
              ConditionExpression: 'BattleSession.BattleId = :id',
              ExpressionAttributeValues: marshall({ ':milk': summary.Milk, ':id': battle.BattleId }),
            })
          )
          .catch((e) => console.error('[FinishBattle] milk summary failed', e));
      } catch (e) {
        console.error('[FinishBattle] milk failed', e);
      }
    }

    // 4-2) 장비 · 스킬 책 보상 (2026-11-25, 사용자: "장비 · 스킬 … 전투 보상") — 의뢰 완료 · 믿을 수 있는 판만. 실패해도 판 끝은 막지 않는다
    if (req.win && why.length === 0) {
      try {
        const rewards = await grantBattleRewards(me, String(battle.Difficulty || 'normal'), String(battle.QuizID || '1'), req.stats.BossDown);
        summary.Rewards = rewards;
        if (rewards.length) {
          await dynamoDBClient
            .send(
              new UpdateItemCommand({
                TableName: PLAYER_TABLE,
                Key: marshall({ PlayerID: me }),
                UpdateExpression: 'SET BattleSession.Summary.Rewards = :rw',
                ConditionExpression: 'BattleSession.BattleId = :id',
                ExpressionAttributeValues: marshall({ ':rw': rewards, ':id': battle.BattleId }, { removeUndefinedValues: true }),
              })
            )
            .catch((e) => console.error('[FinishBattle] rewards summary failed', e));
        }
      } catch (e) {
        console.error('[FinishBattle] rewards failed', e);
      }
    }

    // 5) 마도서 칸
    const book = await grimoireFor(me, req.pool, counts);
    console.log(
      `[FinishBattle] ${me} ${battle.BattleId} ${key} ${summary.Result} answers ${graded} corrects ${corrects} damage ${req.stats.Damage} kills ${req.stats.Kills}` +
        ` plays ${record.Plays} wins ${record.Wins} best ${record.BestDamage}${why.length ? ' SUSPICIOUS ' + why.join(',') : ''}` +
        ` milk ${summary.Milk ? JSON.stringify(summary.Milk) : '-'} rewards ${(summary.Rewards as RewardLine[]).map((r) => `${r.ItemId}x${r.Count}`).join(',') || '-'}` +
        ` book ${book ? `${book.Learned}/${book.Total}` : '-'} achievements ${achievementsAdded ? 'added' : '-'}`
    );
    return createSuccessResponse({ ...summary, Grimoire: book, Replayed: false });
  } catch (e) {
    console.error('[FinishBattle] error', e);
    return createErrorResponse(500, 'Battle finish error', { Reason: 'ServerError' });
  }
};
