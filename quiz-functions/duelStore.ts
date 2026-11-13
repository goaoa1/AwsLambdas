// ========================================
// duelStore.ts - 대결 모드 기록 (2026-11-13, D6). PlayerResources.Duel 맵:
//   { Won: ["Char_003:11", ...], History: [{ Opponent, Table, Mine, Theirs, Date, At }], Recent: { "11": [{ At, A }] }, MilkGiven, UpdatedAt }
//   기기 저장(UDuelSaveGame, 슬롯 "Duel")과 같은 내용. 합칠 때 이긴 칸 · 판 기록 · 최근 판은 합집합(At 로 같은 것을 가림),
//   준 우유 수는 큰 쪽 — 어느 기기에서 먼저 보내도 잃지 않는다. 바나나우유 = 이긴 칸 수 − 준 수 (따로 저장하지 않음).
//   계획: TimesTable/Docs/대결_모드_계획.md
// ========================================
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

export const PLAYER_TABLE = 'PlayerResources';
const client = new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION });

export interface DuelRow { Opponent: string; Table: number; Mine: number; Theirs: number; Date: string; At: string }
export interface DuelRecent { At: string; A: number }
export interface DuelState {
  Won: string[];
  History: DuelRow[];
  Recent: Record<string, DuelRecent[]>;
  MilkGiven: number;
  UpdatedAt: string;
}

const OPPONENTS = new Set(['Char_001', 'Char_002', 'Char_003']);
const MAX_HISTORY = 60;
const MAX_RECENT = 4;   // 최근 3판 + 직전 평균용 하나

export function emptyDuel(): DuelState {
  return { Won: [], History: [], Recent: {}, MilkGiven: 0, UpdatedAt: '' };
}

const isTable = (t: number) => Number.isInteger(t) && t >= 11 && t <= 19;
const cleanAt = (v: unknown) => (typeof v === 'string' ? v.slice(0, 40) : '');

/** 들어온 값(서버 저장 · 요청 본문)을 같은 모양으로 — 모르는 값은 버린다 */
export function normalizeDuel(raw: unknown): DuelState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const won = (Array.isArray(r.Won) ? r.Won : r.Won instanceof Set ? [...r.Won] : [])
    .map(String)
    .filter((w) => {
      const [opp, t] = w.split(':');
      return OPPONENTS.has(opp) && isTable(Number(t));
    });
  const history: DuelRow[] = [];
  for (const h of Array.isArray(r.History) ? r.History : []) {
    const o = (h && typeof h === 'object' ? h : {}) as Record<string, unknown>;
    const row: DuelRow = {
      Opponent: String(o.Opponent ?? ''),
      Table: Number(o.Table),
      Mine: Math.max(0, Math.min(19, Math.floor(Number(o.Mine) || 0))),
      Theirs: Math.max(0, Math.min(19, Math.floor(Number(o.Theirs) || 0))),
      Date: typeof o.Date === 'string' ? o.Date.slice(0, 10) : '',
      At: cleanAt(o.At),
    };
    if (OPPONENTS.has(row.Opponent) && isTable(row.Table) && row.At) history.push(row);
  }
  const recent: Record<string, DuelRecent[]> = {};
  if (r.Recent && typeof r.Recent === 'object') {
    for (const [k, v] of Object.entries(r.Recent as Record<string, unknown>)) {
      if (!isTable(Number(k)) || !Array.isArray(v)) continue;
      const list: DuelRecent[] = [];
      for (const e of v) {
        const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
        const a = Number(o.A);
        const at = cleanAt(o.At);
        if (at && a > 0 && a < 120) list.push({ At: at, A: Math.round(a * 1000) / 1000 });
      }
      recent[String(Number(k))] = list;
    }
  }
  return {
    Won: [...new Set(won)],
    History: history,
    Recent: recent,
    MilkGiven: Math.max(0, Math.min(1000, Math.floor(Number(r.MilkGiven) || 0))),
    UpdatedAt: typeof r.UpdatedAt === 'string' ? r.UpdatedAt : '',
  };
}

/** 서버 값 + 기기 값 → 합친 값 (같은 요청을 두 번 보내도 결과가 같다) */
export function mergeDuel(a: DuelState, b: DuelState): DuelState {
  const won = [...new Set([...a.Won, ...b.Won])].sort();
  const byAt = new Map<string, DuelRow>();
  for (const h of [...a.History, ...b.History]) byAt.set(`${h.At}|${h.Opponent}|${h.Table}`, h);
  const history = [...byAt.values()].sort((x, y) => x.At.localeCompare(y.At)).slice(-MAX_HISTORY);
  const recent: Record<string, DuelRecent[]> = {};
  for (const k of new Set([...Object.keys(a.Recent), ...Object.keys(b.Recent)])) {
    const m = new Map<string, DuelRecent>();
    for (const e of [...(a.Recent[k] ?? []), ...(b.Recent[k] ?? [])]) m.set(e.At, e);
    recent[k] = [...m.values()].sort((x, y) => x.At.localeCompare(y.At)).slice(-MAX_RECENT);
  }
  return { Won: won, History: history, Recent: recent, MilkGiven: Math.max(a.MilkGiven, b.MilkGiven), UpdatedAt: new Date().toISOString() };
}

export async function readDuel(playerId: string): Promise<DuelState> {
  const r = await client.send(
    new GetItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: playerId }),
      ProjectionExpression: 'PlayerID, #duel',
      ExpressionAttributeNames: { '#duel': 'Duel' },
    })
  );
  const row = r.Item ? unmarshall(r.Item) : {};
  return normalizeDuel(row.Duel);
}

export async function writeDuel(playerId: string, state: DuelState): Promise<void> {
  await client.send(
    new UpdateItemCommand({
      TableName: PLAYER_TABLE,
      Key: marshall({ PlayerID: playerId }),
      UpdateExpression: 'SET #duel = :d',
      ExpressionAttributeNames: { '#duel': 'Duel' },
      ExpressionAttributeValues: marshall({ ':d': state }, { removeUndefinedValues: true }),
    })
  );
}
