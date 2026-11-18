// ========================================
// quizMilk.ts - 판 끝 우유 (2026-11-18, 사용자: "판이 끝나면 캐릭터가 플레이어를 칭찬하면서 우유를 건네준다")
//   끝까지 푼 판마다 그 판의 캐릭터가 바나나우유 1개를 준다 — PlayerResources.QuizMilk (숫자, 판 끝마다 ADD).
//   가방의 바나나우유 = 대결로 이긴 칸 수 + QuizMilk − 준 수(Duel.MilkGiven) — 클라이언트 UDuelSubsystem::GetMilk.
//   QuizMilk 는 Duel 맵 밖에 두어 기기 쪽 대결 동기화(update-duel)가 덮어쓰지 못하게 한다. 서버가 판을 끝낼 때만 늘어남.
//   하루 상한 (2026-11-18, 사용자: "want daily cap"): 한국 날짜(KST)로 하루 QUIZ_MILK_DAILY_CAP 개까지.
//     QuizMilkDay(오늘 날짜 문자열) · QuizMilkToday(오늘 받은 수) — 조건부 UpdateItem 두 번으로 동시에 끝난 판도 상한을 넘지 않음.
// ========================================
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });
const PLAYER_TABLE = 'PlayerResources';
export const QUIZ_MILK_PER_QUIZ = 1;
export const QUIZ_MILK_DAILY_CAP = 5;

/** 한국 날짜 'YYYY-MM-DD' (출석과 같은 기준: 자정 KST 에 바뀜) */
export function kstDay(now = Date.now()): string {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export interface QuizMilkGrant {
  gift: number; // 이번 판에 준 수 (상한이면 0)
  total: number; // 지금까지 받은 합 (QuizMilk)
  today: number; // 오늘 받은 수
  cap: number; // 하루 상한
}

const isConditional = (e: unknown) => (e as { name?: string })?.name === 'ConditionalCheckFailedException';

function toGrant(attrs: Record<string, any> | undefined, gift: number, day: string): QuizMilkGrant {
  const a = attrs ? unmarshall(attrs) : {};
  const total = Number(a.QuizMilk);
  const today = a.QuizMilkDay === day ? Number(a.QuizMilkToday) : 0;
  return {
    gift,
    total: Number.isFinite(total) && total > 0 ? Math.floor(total) : 0,
    today: Number.isFinite(today) && today > 0 ? Math.floor(today) : 0,
    cap: QUIZ_MILK_DAILY_CAP,
  };
}

/** 판 끝: 오늘 상한 아래면 n 개를 더한다. 상한이면 gift 0 (던지는 건 DynamoDB 오류뿐 — 부르는 쪽이 채점을 막지 않게 잡는다) */
export async function grantQuizMilk(playerId: string, n = QUIZ_MILK_PER_QUIZ, now = Date.now()): Promise<QuizMilkGrant> {
  const day = kstDay(now);
  const Key = marshall({ PlayerID: playerId });
  // 1) 오늘 이미 받은 적이 있고 아직 상한 아래
  try {
    const r = await client.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key,
        UpdateExpression: 'ADD QuizMilk :n, QuizMilkToday :n',
        ConditionExpression: 'attribute_exists(PlayerID) AND QuizMilkDay = :day AND QuizMilkToday < :cap',
        ExpressionAttributeValues: marshall({ ':n': n, ':day': day, ':cap': QUIZ_MILK_DAILY_CAP }),
        ReturnValues: 'ALL_NEW',
      })
    );
    return toGrant(r.Attributes, n, day);
  } catch (e) {
    if (!isConditional(e)) throw e;
  }
  // 2) 오늘 첫 판 (처음이거나 날이 바뀜)
  try {
    const r = await client.send(
      new UpdateItemCommand({
        TableName: PLAYER_TABLE,
        Key,
        UpdateExpression: 'SET QuizMilkDay = :day, QuizMilkToday = :n ADD QuizMilk :n',
        ConditionExpression: 'attribute_exists(PlayerID) AND (attribute_not_exists(QuizMilkDay) OR QuizMilkDay <> :day)',
        ExpressionAttributeValues: marshall({ ':n': n, ':day': day }),
        ReturnValues: 'ALL_NEW',
      })
    );
    return toGrant(r.Attributes, n, day);
  } catch (e) {
    if (!isConditional(e)) throw e;
  }
  // 3) 오늘 몫을 다 받음 (또는 계정 없음) — 지금 값만 알려 준다
  const r = await client.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key,
      ProjectionExpression: 'QuizMilk, QuizMilkDay, QuizMilkToday',
    })
  );
  return toGrant(r.Item, 0, day);
}

export async function readQuizMilk(playerId: string): Promise<number> {
  const r = await client.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: playerId }),
      ProjectionExpression: 'QuizMilk',
    })
  );
  const v = Number(r.Item ? unmarshall(r.Item).QuizMilk : 0);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
