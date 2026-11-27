// finishBattle.ts
import { DynamoDBClient as DynamoDBClient6, GetItemCommand as GetItemCommand5, UpdateItemCommand as UpdateItemCommand6 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall5, unmarshall as unmarshall4 } from "@aws-sdk/util-dynamodb";
import { createErrorResponse, createSuccessResponse } from "quiz-utils/idempotencyUtils";
import { gradeUserAnswer } from "quiz-utils/gradingManager";

// questionStats.ts
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
var QUESTION_STATS_TABLE = "PlayerQuestionStats";
var ddb = new DynamoDBClient({ region: process.env.REGION });
var key = (questionId) => String(questionId).replace(/[^0-9A-Za-z_]/g, "_");
async function addCounts(playerId, counts) {
  const ids = Object.keys(counts);
  for (let i = 0; i < ids.length; i += 40) {
    const names = {};
    const values = { ":now": { S: (/* @__PURE__ */ new Date()).toISOString() } };
    const parts = [];
    ids.slice(i, i + 40).forEach((id, j) => {
      const q = key(id);
      names[`#a${j}`] = `A_${q}`;
      names[`#c${j}`] = `C_${q}`;
      values[`:a${j}`] = { N: String(counts[id].A) };
      values[`:c${j}`] = { N: String(counts[id].C) };
      parts.push(`#a${j} :a${j}`, `#c${j} :c${j}`);
    });
    await ddb.send(
      new UpdateItemCommand({
        TableName: QUESTION_STATS_TABLE,
        Key: { PlayerID: { S: playerId } },
        UpdateExpression: `SET UpdatedAt = :now ADD ${parts.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values
      })
    );
  }
}
async function readStats(playerId) {
  const res = await ddb.send(
    new GetItemCommand({ TableName: QUESTION_STATS_TABLE, Key: { PlayerID: { S: playerId } }, ConsistentRead: true })
  );
  const out = {};
  for (const [name, value] of Object.entries(res.Item || {})) {
    const m = /^([AC])_(.+)$/.exec(name);
    if (!m || value.N === void 0) continue;
    const row = out[m[2]] ??= { A: 0, C: 0 };
    row[m[1]] = Number(value.N);
  }
  return out;
}

// achievementStats.ts
import { DynamoDBClient as DynamoDBClient2, GetItemCommand as GetItemCommand2, UpdateItemCommand as UpdateItemCommand2 } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
var STATS_TABLE = "PlayerStats";
var client = new DynamoDBClient2({ region: process.env.REGION || process.env.AWS_REGION });
function battleStatUpdate(b) {
  const adds = [];
  const values = {};
  const add = (field, key2, value) => {
    adds.push(`${field} ${key2}`);
    values[key2] = value;
  };
  if (b.Corrects > 0) add("CorrectAnswers", ":correct", b.Corrects);
  if (b.Kills > 0) add("BattleKills", ":kills", b.Kills);
  if (b.Recites > 0) add("BattleRecites", ":recites", b.Recites);
  if (b.Interrupts > 0) add("BossInterrupts", ":breaks", b.Interrupts);
  if (b.Dodged > 0) add("BattleDodges", ":dodged", b.Dodged);
  if (b.Win) {
    add("QuizzesCompleted", ":one", 1);
    if (b.QuizID) add("ClearedQuizIds", ":quiz", /* @__PURE__ */ new Set([String(b.QuizID)]));
    if (b.CharacterId) add("CharactersPlayed", ":char", /* @__PURE__ */ new Set([b.CharacterId]));
    if (b.Wrong === 0 && b.Corrects > 0) adds.push("PerfectQuizzes :one");
  }
  return adds.length ? { adds, values } : null;
}
async function addFinishedBattle(b) {
  const u = battleStatUpdate(b);
  if (!u) return false;
  await client.send(
    new UpdateItemCommand2({
      TableName: STATS_TABLE,
      Key: marshall({ PlayerID: b.PlayerID }),
      UpdateExpression: `ADD ${u.adds.join(", ")}`,
      ExpressionAttributeValues: marshall(u.values, { convertClassInstanceToMap: false })
    })
  );
  return true;
}

// quizMilk.ts
import { DynamoDBClient as DynamoDBClient3, GetItemCommand as GetItemCommand3, UpdateItemCommand as UpdateItemCommand3 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall2, unmarshall as unmarshall2 } from "@aws-sdk/util-dynamodb";
var client2 = new DynamoDBClient3({ region: process.env.REGION || process.env.AWS_REGION });
var PLAYER_TABLE = "PlayerResources";
var QUIZ_MILK_PER_QUIZ = 1;
var QUIZ_MILK_DAILY_CAP = 5;
function kstDay(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1e3).toISOString().slice(0, 10);
}
var isConditional = (e) => e?.name === "ConditionalCheckFailedException";
function toGrant(attrs, gift, day) {
  const a = attrs ? unmarshall2(attrs) : {};
  const total = Number(a.QuizMilk);
  const today = a.QuizMilkDay === day ? Number(a.QuizMilkToday) : 0;
  return {
    gift,
    total: Number.isFinite(total) && total > 0 ? Math.floor(total) : 0,
    today: Number.isFinite(today) && today > 0 ? Math.floor(today) : 0,
    cap: QUIZ_MILK_DAILY_CAP
  };
}
async function grantQuizMilk(playerId, n = QUIZ_MILK_PER_QUIZ, now = Date.now()) {
  const day = kstDay(now);
  const Key = marshall2({ PlayerID: playerId });
  try {
    const r2 = await client2.send(
      new UpdateItemCommand3({
        TableName: PLAYER_TABLE,
        Key,
        UpdateExpression: "ADD QuizMilk :n, QuizMilkToday :n",
        ConditionExpression: "attribute_exists(PlayerID) AND QuizMilkDay = :day AND QuizMilkToday < :cap",
        ExpressionAttributeValues: marshall2({ ":n": n, ":day": day, ":cap": QUIZ_MILK_DAILY_CAP }),
        ReturnValues: "ALL_NEW"
      })
    );
    return toGrant(r2.Attributes, n, day);
  } catch (e) {
    if (!isConditional(e)) throw e;
  }
  try {
    const r2 = await client2.send(
      new UpdateItemCommand3({
        TableName: PLAYER_TABLE,
        Key,
        UpdateExpression: "SET QuizMilkDay = :day, QuizMilkToday = :n ADD QuizMilk :n",
        ConditionExpression: "attribute_exists(PlayerID) AND (attribute_not_exists(QuizMilkDay) OR QuizMilkDay <> :day)",
        ExpressionAttributeValues: marshall2({ ":n": n, ":day": day }),
        ReturnValues: "ALL_NEW"
      })
    );
    return toGrant(r2.Attributes, n, day);
  } catch (e) {
    if (!isConditional(e)) throw e;
  }
  const r = await client2.send(
    new GetItemCommand3({
      TableName: PLAYER_TABLE,
      Key,
      ProjectionExpression: "QuizMilk, QuizMilkDay, QuizMilkToday"
    })
  );
  return toGrant(r.Item, 0, day);
}

// gearRewards.ts
import { DynamoDBClient as DynamoDBClient5, UpdateItemCommand as UpdateItemCommand5 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall4 } from "@aws-sdk/util-dynamodb";

// gearCatalog.ts
var MAX_GEAR_COUNT = 5;
var BOOK_ID = "Book_Skill";
var BOOK_NAME = "\uC2A4\uD0AC \uCC45";
var MAX_BOOK_COUNT = 99;
var GEAR = [
  { ItemId: "Gear_W_Branch", Slot: "Weapon", Rarity: "Common", Name: "\uB098\uBB47\uAC00\uC9C0 \uC9C0\uD321\uC774", Desc: "\uC8FC\uBB38 \uC704\uB825 +10%", Stats: { Power: 0.1 }, Price: 120, Level: 0 },
  { ItemId: "Gear_W_Oak", Slot: "Weapon", Rarity: "Rare", Name: "\uCC38\uB098\uBB34 \uC9C0\uD321\uC774", Desc: "\uC8FC\uBB38 \uC704\uB825 +20%", Stats: { Power: 0.2 }, Price: 300, Level: 0 },
  { ItemId: "Gear_W_Star", Slot: "Weapon", Rarity: "Epic", Name: "\uBCC4\uBE5B \uC9C0\uD321\uC774", Desc: "\uC8FC\uBB38 \uC704\uB825 +35%", Stats: { Power: 0.35 }, Price: 0, Level: 0 },
  { ItemId: "Gear_A_Cloak", Slot: "Armor", Rarity: "Common", Name: "\uB204\uBE48 \uB9DD\uD1A0", Desc: "\uCCB4\uB825 +20", Stats: { Hp: 20 }, Price: 100, Level: 0 },
  { ItemId: "Gear_A_Robe", Slot: "Armor", Rarity: "Rare", Name: "\uACAC\uC2B5\uC0DD \uB85C\uBE0C", Desc: "\uCCB4\uB825 +35, \uBC1B\uB294 \uD53C\uD574 \u221210%", Stats: { Hp: 35, Guard: 0.1 }, Price: 280, Level: 0 },
  { ItemId: "Gear_A_Silver", Slot: "Armor", Rarity: "Epic", Name: "\uC740\uC2E4 \uB85C\uBE0C", Desc: "\uCCB4\uB825 +50, \uBC1B\uB294 \uD53C\uD574 \u221220%", Stats: { Hp: 50, Guard: 0.2 }, Price: 0, Level: 0 },
  { ItemId: "Gear_C_Bell", Slot: "Accessory", Rarity: "Common", Name: "\uBC15\uC790 \uBC29\uC6B8", Desc: "\uC554\uC1A1 \uC2DC\uAC04 +0.5\uCD08", Stats: { Recite: 0.5 }, Price: 150, Level: 0 },
  { ItemId: "Gear_C_Ring", Slot: "Accessory", Rarity: "Rare", Name: "\uB9C8\uB825 \uBC18\uC9C0", Desc: "\uB9C8\uB825 +25%", Stats: { Mana: 0.25 }, Price: 260, Level: 0 },
  { ItemId: "Gear_C_Pendant", Slot: "Accessory", Rarity: "Epic", Name: "\uACF5\uBA85 \uBAA9\uAC78\uC774", Desc: "\uACF5\uBA85\uC774 30% \uBE68\uB9AC \uCC2C\uB2E4", Stats: { Resonance: 0.3 }, Price: 0, Level: 0 }
];
var REWARD_BY_DIFFICULTY = {
  easy: { BookChance: 0, ExtraBookChance: 0, GearChance: 0.08 },
  normal: { BookChance: 0, ExtraBookChance: 0, GearChance: 0.15 },
  hard: { BookChance: 0, ExtraBookChance: 0, GearChance: 0.25 },
  veryhard: { BookChance: 0, ExtraBookChance: 0, GearChance: 0.4 }
};
var BOSS_GEAR_BONUS = 0.1;
function rarityWeights(volume) {
  if (volume >= 17) return { Common: 0.4, Rare: 0.4, Epic: 0.2 };
  if (volume >= 14) return { Common: 0.7, Rare: 0.3, Epic: 0 };
  return { Common: 1, Rare: 0, Epic: 0 };
}

// inventoryStore.ts
import { DynamoDBClient as DynamoDBClient4, GetItemCommand as GetItemCommand4, UpdateItemCommand as UpdateItemCommand4 } from "@aws-sdk/client-dynamodb";
import { marshall as marshall3, unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";

// itemCatalog.ts
var MAX_ITEM_COUNT = 99;

// giftRules.ts
var MAX_STAMINA = 10;
var REGEN_INTERVAL_MS = 10 * 60 * 1e3;
function effectiveStamina(stored, lastUpdateAt, nowMs = Date.now()) {
  if (stored >= MAX_STAMINA || lastUpdateAt == null) return { stamina: Math.min(stored, MAX_STAMINA), clock: lastUpdateAt };
  const regen = Math.floor((nowMs - lastUpdateAt) / REGEN_INTERVAL_MS);
  if (regen <= 0) return { stamina: stored, clock: lastUpdateAt };
  const stamina = Math.min(stored + regen, MAX_STAMINA);
  return { stamina, clock: stamina >= MAX_STAMINA ? void 0 : lastUpdateAt + regen * REGEN_INTERVAL_MS };
}

// inventoryStore.ts
var PLAYER_TABLE2 = "PlayerResources";
var client3 = new DynamoDBClient4({ region: process.env.REGION || process.env.AWS_REGION });
async function readPlayerItems(playerId, nowMs = Date.now()) {
  const r = await client3.send(
    new GetItemCommand4({
      TableName: PLAYER_TABLE2,
      Key: marshall3({ PlayerID: playerId }),
      ProjectionExpression: "PlayerID, #items, Credits, Stamina, LastStaminaUpdateAt",
      ExpressionAttributeNames: { "#items": "Items" }
      // Items 는 DynamoDB 예약어
    })
  );
  const p = r.Item ? unmarshall3(r.Item) : {};
  const stored = Number(p.Stamina) || 0;
  const eff = effectiveStamina(stored, p.LastStaminaUpdateAt, nowMs);
  const items = {};
  for (const [k, v] of Object.entries(p.Items ?? {})) items[k] = Number(v) || 0;
  return { Items: items, Credits: Number(p.Credits) || 0, StoredStamina: stored, Stamina: eff.stamina, Clock: eff.clock, Exists: !!r.Item };
}
async function ensureItemsMap(playerId) {
  try {
    await client3.send(
      new UpdateItemCommand4({
        TableName: PLAYER_TABLE2,
        Key: marshall3({ PlayerID: playerId }),
        UpdateExpression: "SET #items = if_not_exists(#items, :empty)",
        ConditionExpression: "attribute_exists(PlayerID)",
        ExpressionAttributeNames: { "#items": "Items" },
        ExpressionAttributeValues: marshall3({ ":empty": {} })
      })
    );
  } catch (e) {
    if (e.name !== "ConditionalCheckFailedException") throw e;
  }
}
function grantItemsExpression(grants, current, prefix = "g") {
  const sets = [];
  const conds = [];
  const names = { "#items": "Items" };
  const values = {};
  const granted = {};
  let i = 0;
  for (const [itemId, n] of Object.entries(grants)) {
    if (!n || n <= 0) continue;
    const cur = current[itemId] ?? 0;
    const next = Math.min(MAX_ITEM_COUNT, cur + n);
    granted[itemId] = next - cur;
    names[`#${prefix}${i}`] = itemId;
    values[`:${prefix}${i}`] = next;
    sets.push(`#items.#${prefix}${i} = :${prefix}${i}`);
    values[`:${prefix}c${i}`] = cur;
    conds.push(`(attribute_not_exists(#items.#${prefix}${i}) OR #items.#${prefix}${i} = :${prefix}c${i})`);
    i++;
  }
  if (!sets.length) delete names["#items"];
  return { sets, conds, names, values, granted };
}

// gearRewards.ts
var client4 = new DynamoDBClient5({ region: process.env.REGION || process.env.AWS_REGION });
function rollBattleRewards(difficulty, quizId, bossDown, current, rnd = Math.random) {
  const cfg = REWARD_BY_DIFFICULTY[difficulty] ?? REWARD_BY_DIFFICULTY.normal;
  let books = 0;
  if (rnd() < cfg.BookChance) books++;
  if (cfg.ExtraBookChance > 0 && rnd() < cfg.ExtraBookChance) books++;
  let gearId;
  if (rnd() < Math.min(1, cfg.GearChance + (bossDown ? BOSS_GEAR_BONUS : 0))) {
    const volume = 10 + (Number(quizId) || 1);
    const w = rarityWeights(volume);
    let r = rnd();
    let rarity = "Common";
    for (const k of ["Common", "Rare", "Epic"]) {
      if (r < w[k]) {
        rarity = k;
        break;
      }
      r -= w[k];
    }
    const notFull = (id) => (current[id] ?? 0) < MAX_GEAR_COUNT;
    let pool = GEAR.filter((g) => g.Rarity === rarity && notFull(g.ItemId));
    if (!pool.length) pool = GEAR.filter((g) => w[g.Rarity] > 0 && notFull(g.ItemId));
    if (pool.length) gearId = pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))].ItemId;
    else books++;
  }
  const grants = {};
  const lines = [];
  if (gearId) {
    const g = GEAR.find((x) => x.ItemId === gearId);
    grants[gearId] = 1;
    lines.push({ ItemId: gearId, Name: g.Name, Kind: "Gear", Count: 1, Slot: g.Slot, Rarity: g.Rarity });
  }
  const bookRoom = Math.max(0, MAX_BOOK_COUNT - (current[BOOK_ID] ?? 0));
  const bookGrant = Math.min(books, bookRoom);
  if (bookGrant > 0) {
    grants[BOOK_ID] = bookGrant;
    lines.push({ ItemId: BOOK_ID, Name: BOOK_NAME, Kind: "Book", Count: bookGrant });
  }
  return { grants, lines };
}
async function grantBattleRewards(playerId, difficulty, quizId, bossDown) {
  await ensureItemsMap(playerId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await readPlayerItems(playerId);
    const { grants, lines } = rollBattleRewards(difficulty, quizId, bossDown, row.Items);
    if (!lines.length) return [];
    const ex = grantItemsExpression(grants, row.Items, "r");
    if (!ex.sets.length) return [];
    try {
      await client4.send(
        new UpdateItemCommand5({
          TableName: PLAYER_TABLE2,
          Key: marshall4({ PlayerID: playerId }),
          UpdateExpression: `SET ${ex.sets.join(", ")}`,
          ConditionExpression: ex.conds.join(" AND "),
          ExpressionAttributeNames: ex.names,
          ExpressionAttributeValues: marshall4(ex.values)
        })
      );
      return lines;
    } catch (e) {
      if (e.name !== "ConditionalCheckFailedException") throw e;
    }
  }
  return [];
}

// battleRules.ts
var MAX_ANSWERS = 600;
var MAX_POOL = 40;
var LEARN_MIN_ANSWERS = 3;
var LEARN_RATE = 0.8;
var DAMAGE_PER_CORRECT_CAP = 2e3;
var ALLY_DAMAGE_PER_SECOND = 60;
var num = (v, max = 1e9) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
};
var qid = (v) => typeof v === "string" || typeof v === "number" ? String(v) : "";
function parseFinishRequest(body) {
  const b = body ?? {};
  const battleId = typeof b.BattleId === "string" ? b.BattleId : "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(battleId)) return "Bad BattleId";
  const result = b.Result;
  if (result !== "win" && result !== "retreat") return "Bad Result";
  const st = b.Stats ?? {};
  const stats = {
    Damage: Math.round(num(st.Damage)),
    Kills: Math.round(num(st.Kills, 1e5)),
    Recites: Math.round(num(st.Recites, 1e5)),
    MaxChain: Math.round(num(st.MaxChain, 1e5)),
    BestShot: Math.round(num(st.BestShot)),
    Wrong: Math.round(num(st.Wrong, 1e5)),
    Releases: Math.round(num(st.Releases, 1e5)),
    Level: Math.round(num(st.Level, 1e3)),
    Skills: Math.round(num(st.Skills, 1e5)),
    BossDown: st.BossDown === true,
    Dodged: Math.round(num(st.Dodged, 1e5)),
    Taken: Math.round(num(st.Taken, 1e5)),
    Interrupts: Math.round(num(st.Interrupts, 1e5))
  };
  const rawAnswers = Array.isArray(b.Answers) ? b.Answers : [];
  if (rawAnswers.length > MAX_ANSWERS) return "Too many answers";
  const answers = [];
  for (const r of rawAnswers) {
    const o = r ?? {};
    const q = qid(o.Q);
    if (!/^[0-9A-Za-z_]{1,24}$/.test(q)) continue;
    answers.push({ q, a: String(o.A ?? "").slice(0, 24), ms: Math.round(num(o.Ms, 6e5)) });
  }
  const pool = (Array.isArray(b.Pool) ? b.Pool : []).map(qid).filter((q) => /^[0-9A-Za-z_]{1,24}$/.test(q)).slice(0, MAX_POOL);
  return { battleId, win: result === "win", seconds: num(b.Seconds, 7200), stats, answers, pool };
}
function suspicious(req, elapsedMs, corrects) {
  const why = [];
  if (req.seconds * 1e3 > elapsedMs + 15e3) why.push("seconds>elapsed");
  if (req.answers.length > req.seconds * 3 + 10) why.push("answers>time");
  if (req.stats.Damage > corrects * DAMAGE_PER_CORRECT_CAP + req.seconds * ALLY_DAMAGE_PER_SECOND) why.push("damage>corrects");
  if (req.stats.Recites > corrects) why.push("recites>corrects");
  if (req.stats.Interrupts > corrects) why.push("interrupts>corrects");
  if (req.stats.Dodged > req.seconds / 2 + 5) why.push("dodged>time");
  if (req.stats.Kills > corrects * 8 + 10) why.push("kills>corrects");
  return why;
}
function updateRecord(prev, win, stats, trusted, now) {
  const p = {
    Plays: num(prev?.Plays),
    Wins: num(prev?.Wins),
    BestDamage: num(prev?.BestDamage),
    BestKills: num(prev?.BestKills),
    BestChain: num(prev?.BestChain),
    LastAt: typeof prev?.LastAt === "string" ? prev.LastAt : ""
  };
  const newBest = {
    Damage: trusted && stats.Damage > p.BestDamage,
    Kills: trusted && stats.Kills > p.BestKills,
    Chain: trusted && stats.MaxChain > p.BestChain
  };
  const record = {
    Plays: p.Plays + 1,
    Wins: p.Wins + (win ? 1 : 0),
    BestDamage: newBest.Damage ? stats.Damage : p.BestDamage,
    BestKills: newBest.Kills ? stats.Kills : p.BestKills,
    BestChain: newBest.Chain ? stats.MaxChain : p.BestChain,
    LastAt: now
  };
  return { record, newBest };
}
var learned = (a, c) => a >= LEARN_MIN_ANSWERS && c / Math.max(a, 1) >= LEARN_RATE;
function grimoire(pool, after, added) {
  const cells = pool.map((q) => {
    const now = after[q] ?? { A: 0, C: 0 };
    const plus = added[q] ?? { A: 0, C: 0 };
    const was = learned(now.A - plus.A, now.C - plus.C);
    const isNow = learned(now.A, now.C);
    return { Q: q, A: now.A, C: now.C, Learned: isNow, New: isNow && !was };
  });
  return { Cells: cells, Learned: cells.filter((c) => c.Learned).length, Total: cells.length };
}

// finishBattle.ts
var dynamoDBClient = new DynamoDBClient6({ region: process.env.REGION });
var PLAYER_TABLE3 = "PlayerResources";
function getUserId(event) {
  return event.requestContext?.authorizer?.claims?.sub;
}
function isConditionFailure(e) {
  return e?.name === "ConditionalCheckFailedException";
}
async function readPlayer(me) {
  const res = await dynamoDBClient.send(
    new GetItemCommand5({
      TableName: PLAYER_TABLE3,
      Key: marshall5({ PlayerID: me }),
      ProjectionExpression: "PlayerID, BattleSession, BattleRecords, BattleTotals",
      ConsistentRead: true
    })
  );
  return res.Item ? unmarshall4(res.Item) : void 0;
}
async function grimoireFor(me, pool, added) {
  if (pool.length === 0) return null;
  try {
    return grimoire(pool, await readStats(me), added);
  } catch (e) {
    console.error("[FinishBattle] grimoire read failed", e);
    return null;
  }
}
var handler = async (event) => {
  const me = getUserId(event);
  if (!me) return createErrorResponse(401, "Unauthorized");
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return createErrorResponse(400, "Bad JSON", { Reason: "BadRequest" });
  }
  const req = parseFinishRequest(body);
  if (typeof req === "string") return createErrorResponse(400, req, { Reason: "BadRequest" });
  try {
    const player = await readPlayer(me);
    if (!player) return createErrorResponse(404, "Player not found", { Reason: "NoPlayer" });
    const battle = player.BattleSession;
    if (!battle || battle.BattleId !== req.battleId) {
      console.log(`[FinishBattle] ${me} battle ${req.battleId} not current (${battle?.BattleId ?? "-"})`);
      return createErrorResponse(409, "Not the current battle", { Reason: "NoBattle" });
    }
    if (battle.Status === "Finished") {
      console.log(`[FinishBattle] ${me} replay ${battle.BattleId}`);
      return createSuccessResponse({ ...battle.Summary ?? {}, Grimoire: await grimoireFor(me, req.pool, {}), Replayed: true });
    }
    const ids = [...new Set(req.answers.map((a) => a.q))];
    await Promise.all(ids.map((q) => gradeUserAnswer(q, "").catch(() => void 0)));
    const counts = {};
    let corrects = 0;
    let graded = 0;
    for (const ans of req.answers) {
      let correct = false;
      try {
        correct = !!(await gradeUserAnswer(ans.q, ans.a)).bIsCorrect;
      } catch {
        continue;
      }
      const row = counts[ans.q] ??= { A: 0, C: 0 };
      row.A += 1;
      row.C += correct ? 1 : 0;
      corrects += correct ? 1 : 0;
      graded += 1;
    }
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const why = suspicious(req, nowMs - Number(battle.StartedAtMs || nowMs), corrects);
    const key2 = `${battle.QuizID}_${battle.Difficulty}`;
    const records = { ...player.BattleRecords ?? {} };
    const { record, newBest } = updateRecord(records[key2], req.win, req.stats, why.length === 0, now);
    records[key2] = record;
    const t = player.BattleTotals ?? {};
    const totals = {
      Plays: Number(t.Plays ?? 0) + 1,
      Wins: Number(t.Wins ?? 0) + (req.win ? 1 : 0),
      Kills: Number(t.Kills ?? 0) + req.stats.Kills,
      Damage: Number(t.Damage ?? 0) + req.stats.Damage,
      Answers: Number(t.Answers ?? 0) + graded,
      Corrects: Number(t.Corrects ?? 0) + corrects,
      Dodged: Number(t.Dodged ?? 0) + req.stats.Dodged
    };
    const summary = {
      Result: req.win ? "win" : "retreat",
      Graded: { Answers: graded, Corrects: corrects },
      Record: { Key: key2, ...record },
      NewBest: newBest,
      Milk: null,
      Rewards: [],
      Suspicious: why
    };
    try {
      await dynamoDBClient.send(
        new UpdateItemCommand6({
          TableName: PLAYER_TABLE3,
          Key: marshall5({ PlayerID: me }),
          UpdateExpression: "SET BattleSession.#st = :fin, BattleSession.FinishedAt = :now, BattleSession.Summary = :sum, BattleRecords = :recs, BattleTotals = :tot, UpdatedAt = :now",
          ConditionExpression: "attribute_exists(BattleSession) AND BattleSession.BattleId = :id AND BattleSession.#st = :active",
          ExpressionAttributeNames: { "#st": "Status" },
          ExpressionAttributeValues: marshall5(
            { ":fin": "Finished", ":active": "Active", ":now": now, ":sum": summary, ":recs": records, ":tot": totals, ":id": battle.BattleId },
            { removeUndefinedValues: true }
          )
        })
      );
    } catch (e) {
      if (!isConditionFailure(e)) throw e;
      const again = await readPlayer(me);
      const b2 = again?.BattleSession;
      if (b2 && b2.BattleId === req.battleId && b2.Status === "Finished") {
        return createSuccessResponse({ ...b2.Summary ?? {}, Grimoire: await grimoireFor(me, req.pool, {}), Replayed: true });
      }
      return createErrorResponse(409, "Not the current battle", { Reason: "NoBattle" });
    }
    try {
      if (Object.keys(counts).length > 0) await addCounts(me, counts);
    } catch (e) {
      console.error("[FinishBattle] question stats failed", e);
    }
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
          Dodged: req.stats.Dodged
        });
      } catch (e) {
        console.error("[FinishBattle] achievement stats failed", e);
      }
    }
    if (req.win && why.length === 0) {
      try {
        const g = await grantQuizMilk(me);
        summary.Milk = { Gift: g.gift, Today: g.today, Cap: g.cap, Total: g.total };
        await dynamoDBClient.send(
          new UpdateItemCommand6({
            TableName: PLAYER_TABLE3,
            Key: marshall5({ PlayerID: me }),
            UpdateExpression: "SET BattleSession.Summary.Milk = :milk",
            ConditionExpression: "BattleSession.BattleId = :id",
            ExpressionAttributeValues: marshall5({ ":milk": summary.Milk, ":id": battle.BattleId })
          })
        ).catch((e) => console.error("[FinishBattle] milk summary failed", e));
      } catch (e) {
        console.error("[FinishBattle] milk failed", e);
      }
    }
    if (req.win && why.length === 0) {
      try {
        const rewards = await grantBattleRewards(me, String(battle.Difficulty || "normal"), String(battle.QuizID || "1"), req.stats.BossDown);
        summary.Rewards = rewards;
        if (rewards.length) {
          await dynamoDBClient.send(
            new UpdateItemCommand6({
              TableName: PLAYER_TABLE3,
              Key: marshall5({ PlayerID: me }),
              UpdateExpression: "SET BattleSession.Summary.Rewards = :rw",
              ConditionExpression: "BattleSession.BattleId = :id",
              ExpressionAttributeValues: marshall5({ ":rw": rewards, ":id": battle.BattleId }, { removeUndefinedValues: true })
            })
          ).catch((e) => console.error("[FinishBattle] rewards summary failed", e));
        }
      } catch (e) {
        console.error("[FinishBattle] rewards failed", e);
      }
    }
    const book = await grimoireFor(me, req.pool, counts);
    console.log(
      `[FinishBattle] ${me} ${battle.BattleId} ${key2} ${summary.Result} answers ${graded} corrects ${corrects} damage ${req.stats.Damage} kills ${req.stats.Kills} plays ${record.Plays} wins ${record.Wins} best ${record.BestDamage}${why.length ? " SUSPICIOUS " + why.join(",") : ""} milk ${summary.Milk ? JSON.stringify(summary.Milk) : "-"} rewards ${summary.Rewards.map((r) => `${r.ItemId}x${r.Count}`).join(",") || "-"} book ${book ? `${book.Learned}/${book.Total}` : "-"} achievements ${achievementsAdded ? "added" : "-"}`
    );
    return createSuccessResponse({ ...summary, Grimoire: book, Replayed: false });
  } catch (e) {
    console.error("[FinishBattle] error", e);
    return createErrorResponse(500, "Battle finish error", { Reason: "ServerError" });
  }
};
export {
  handler
};
