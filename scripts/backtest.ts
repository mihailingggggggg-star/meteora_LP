/**
 * Бэктест «что было бы по новым правилам».
 *
 * Для каждого пула берём реальный вход (дату-время из базы), строим позицию
 * ТЕМИ ЖЕ функциями, что использует движок (buildBalancedPlan / positionValue),
 * и считаем комиссии по историческим бакетам пула (volume/history: fees = LP-доля,
 * уже без протокола), IL — по биновой лестнице.
 *
 * Запуск:
 *   npx tsx scripts/backtest.ts '[{"name":"CARDS-SOL","address":"...","entry":1793069535138}]'
 *
 * Ограничения (важно):
 *  • ликвидность по бинам берётся текущая — исторической нет;
 *  • fee/TVL и ATR считаются на момент входа, но берём только те данные, которые есть;
 *  • выход по «пул остыл»/фильтрам не моделируется — только пробой диапазона (30 мин) и горизонт.
 */
import { fetchPool } from "../apps/engine/src/meteora.js";
import { readBinLiquidity } from "../apps/engine/src/chain.js";
import { buildBalancedPlan, positionValue } from "../apps/engine/src/strategy.js";
import { env } from "../apps/engine/src/env.js";

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

const CAPITAL = 146; // столько даёт риск-лимит 3 % депозита при диапазоне ±10 %
const HOLD_HOURS = 12;
const OUT_MINUTES = 30; // grace перед выходом
const EXIT_COST_PCT = 0.25; // friction 0.15 % + слиппедж ~0.1 %
const ENTRY_COST_PCT = 0.3;

function settings() {
  return {
    maxAtrPct: 6.5,
    minTurnover: 1.0,
    minPoolTvl: 50_000,
    minTxns24h: 0,
    minHolders: 300,
    rangeAtrMult: 1.5,
    maxRangePct: 25,
    rangeHorizonHours: 4,
    minBinsPerSide: 9,
    maxBinsPerSide: 35,
    minFeeTvlPct: 1.5,
    budgetPct: 50,
    frictionPct: 0.15,
    maxLossPerTradePct: 3,
    utilization: 0.85,
    minVol1h: 500,
    minAgeHours: 6,
    maxTurnover: 60,
    distribution: "uniform" as const,
  };
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${env.meteoraApi}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return (await res.json()) as T;
}

async function candles(addr: string, from: number, to: number): Promise<Candle[]> {
  const d = await api<any>(`/pools/${addr}/ohlcv?timeframe=30m&start_time=${Math.floor(from / 1000)}&end_time=${Math.floor(to / 1000)}`);
  return (d.data ?? [])
    .map((r: any) => ({ t: Number(r.timestamp) * 1000, o: +r.open, h: +r.high, l: +r.low, c: +r.close, v: +r.volume }))
    .filter((c: Candle) => c.c > 0)
    .sort((a: Candle, b: Candle) => a.t - b.t);
}

async function feeBuckets(addr: string, from: number, to: number): Promise<Map<number, number>> {
  const d = await api<any>(`/pools/${addr}/volume/history?timeframe=30m&start_time=${Math.floor(from / 1000)}&end_time=${Math.floor(to / 1000)}`);
  const m = new Map<number, number>();
  for (const r of d.data ?? []) m.set(Number(r.timestamp) * 1000, Number(r.fees ?? 0)); // LP-доля, без протокола
  return m;
}

function atr(cs: Candle[]): number {
  const sl = cs.slice(-14);
  if (!sl.length) return 0;
  return (sl.reduce((s, c) => s + (c.h - c.l) / c.c, 0) / sl.length) * 100;
}

/** доля свечи, попавшая в коридор [lo, hi] */
function overlapShare(c: Candle, lo: number, hi: number): number {
  const span = Math.max(1e-12, c.h - c.l);
  const left = Math.max(c.l, lo);
  const right = Math.min(c.h, hi);
  return Math.max(0, Math.min(1, (right - left) / span));
}

async function runOne(item: { name: string; address: string; entry: number }) {
  const entryTs = item.entry;
  const pool = await fetchPool(item.address);
  if (!pool) return { ...item, error: "пул не найден" };

  const from = entryTs - 6 * 3600_000;
  // не заглядываем в будущее: окно обрезается текущим временем
  const to = Math.min(entryTs + HOLD_HOURS * 3600_000, Date.now());
  const cs = await candles(item.address, from, to);
  const before = cs.filter((c) => c.t <= entryTs);
  if (before.length < 6) return { ...item, error: `мало истории (${before.length} свечей)` };
  const entryCandle = before[before.length - 1];
  const entryPrice = entryCandle.c;
  const atrEntry = atr(before);

  // доходность пула НА МОМЕНТ ВХОДА: сумма комиссий за 24ч до входа / текущий TVL
  const before24 = await feeBuckets(item.address, entryTs - 24 * 3600_000, entryTs);
  const fees24Entry = [...before24.values()].reduce((a, b) => a + b, 0);
  const feeTvlEntry = pool.tvl > 0 ? (fees24Entry / pool.tvl) * 100 : 0;
  const poolAtEntry = { ...pool, feeTvl24h: feeTvlEntry, fees24: fees24Entry };

  let binData;
  try {
    binData = await readBinLiquidity(pool, 0.08);
  } catch {
    binData = { activePrice: entryPrice, bins: [], source: "estimate" as const };
  }

  const st = settings();
  const plan = buildBalancedPlan({ pool: poolAtEntry, candles30m: before, binData, deposit: 500, settings: st });
  const base = {
    name: item.name,
    atr: atrEntry,
    feeTvl: feeTvlEntry,
    feeTvlNow: pool.feeTvl24h,
    binStep: pool.binStep,
  };
  if (!plan) {
    const why =
      feeTvlEntry < st.minFeeTvlPct
        ? `fee/TVL на входе ${feeTvlEntry.toFixed(2)} < ${st.minFeeTvlPct}`
        : atrEntry > st.maxAtrPct
          ? `ATR ${atrEntry.toFixed(2)} > ${st.maxAtrPct}`
          : "диапазон/бины/покрытие ATR";
    return { ...base, taken: false as const, why };
  }

  const capital = Math.min(plan.capital, CAPITAL);
  const entryCost = capital * (ENTRY_COST_PCT / 100);
  const net = capital - entryCost;
  const scale = net / Math.max(1e-9, plan.capital);
  const bins = plan.bins.map((b) => ({ priceRel: b.priceRel, usd: b.usd * scale }));
  const lo = entryPrice * (1 - plan.rangePct);
  const hi = entryPrice * (1 + plan.rangePct);

  const fees = await feeBuckets(item.address, from, to);
  const rangeLiquidity = Math.max(1, plan.rangeLiquidity);
  const share = Math.min(0.5, net / (net + rangeLiquidity));

  let acc = 0;
  let outSince: number | null = null;
  let exitAt: number | null = null;
  let exitPrice = 0;
  let reason = "горизонт";
  for (const c of cs) {
    if (c.t <= entryTs) continue;
    const rel = c.c / entryPrice;
    const f = fees.get(c.t) ?? 0;
    acc += f * overlapShare(c, lo, hi) * share * st.utilization;
    const out = c.c > hi || c.c < lo;
    if (out) {
      if (outSince == null) outSince = c.t;
      if (c.t - outSince >= OUT_MINUTES * 60_000) {
        exitAt = c.t;
        exitPrice = c.c;
        reason = "пробой диапазона";
        break;
      }
    } else outSince = null;
  }
  const past = cs.filter((c) => c.t <= Date.now());
  const lastCandle = past[past.length - 1] ?? entryCandle;
  const endTs = exitAt ?? lastCandle.t;
  const markPrice = exitAt ? exitPrice : lastCandle.c;
  const relEnd = markPrice / entryPrice;
  const { value } = positionValue(bins, relEnd);
  const exitCost = exitAt ? value * (EXIT_COST_PCT / 100) : 0;
  const pnl = value - exitCost + acc - capital; // capital = потрачено (с издержками входа)
  const hours = (endTs - entryTs) / 3600_000;
  return {
    ...base,
    taken: true as const,
    rangePct: plan.rangePct,
    bins: plan.bins.length,
    capital,
    fees: acc,
    value,
    exitCost,
    pnl,
    pnlPct: (pnl / capital) * 100,
    hours,
    reason,
    retPerDay: hours > 0.3 ? (pnl / capital) * (24 / hours) * 100 : 0,
  };
}

async function main() {
  const items = JSON.parse(process.argv[2] || "[]");
  const out = [];
  for (const it of items) {
    try {
      out.push(await runOne(it));
    } catch (e: any) {
      out.push({ name: it.name, error: String(e?.message ?? e) });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(JSON.stringify(out, null, 1));
}

void main();
