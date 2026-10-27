import type { Pool } from "./meteora.js";
import type { Candle } from "./market.js";
import type { BinLiquidity } from "./chain.js";

/** Свеча 30m: ATR(14) — средний размах свечи в процентах. */
export function computeAtr(candles: Candle[], period = 14): number {
  const slice = candles.slice(-period);
  if (!slice.length) return 0;
  const sum = slice.reduce((s, c) => s + (c.c > 0 ? (c.h - c.l) / c.c : 0), 0);
  return (sum / slice.length) * 100;
}

/** Доля объёма, прошедшего внутри коридора ±halfRange (доля, не проценты). */
export function volumeShareInRange(candles: Candle[], priceRef: number, halfRange: number): number {
  if (!candles.length || !priceRef) return 0;
  let inRange = 0;
  let total = 0;
  for (const c of candles) {
    total += c.v;
    const lo = c.l / priceRef - 1;
    const hi = c.h / priceRef - 1;
    if (hi >= -halfRange && lo <= halfRange) inRange += c.v;
  }
  return total > 0 ? inRange / total : 0;
}

export type PlanBin = {
  k: number;
  priceRel: number;
  weight: number;
  usd: number;
  /** ликвидность пула в этом бине (USD) — нужна для доли комиссий в реальном времени */
  poolUsd: number;
  feePerDay: number;
};

export type StrategyPlan = {
  pool: Pool;
  atrPct: number;
  turnover24: number; // vol24 / tvl
  turnover1h: number;
  txns24: number;
  rangePct: number; // половина диапазона, например 0.025
  concentration: number; // 1 / (2*rangePct)
  bins: PlanBin[];
  capital: number;
  feeRate: number;
  rangeLiquidity: number;
  activeTvl: number;
  inRangeShare: number;
  /** средняя цена входа токеновой части, относительно центра (1.0 = центр сетки) */
  avgEntryPriceRel: number;
  distribution: "spot" | "curve" | "uniform";
  expectedDailyPct: number;
  expected15hPct: number;
  volumeForFees: number;
  notes: string[];
  score: number;
};

export type StrategySettings = {
  maxAtrPct: number;
  minTurnover: number;
  minPoolTvl: number;
  minTxns24h: number;
  minHolders?: number;
  rangeAtrMult: number;
  maxRangePct: number;
  budgetPct: number; // доля депозита на позицию
  frictionPct: number; // издержки свопа при ребалансе, %
  maxLossPerTradePct: number;
  utilization: number;
  /** форма распределения капитала по бинам: spot (колокол, как в Meteora), curve, uniform */
  distribution?: "spot" | "curve" | "uniform";
};

/**
 * План двусторонней позиции 50/50 с узким диапазоном ±range.
 * Возвращает null, если пул не проходит фильтры.
 */
export function buildBalancedPlan(opts: {
  pool: Pool;
  candles30m: Candle[];
  binData: { activePrice: number; bins: BinLiquidity[]; source: "chain" | "estimate" };
  deposit: number;
  settings: StrategySettings;
}): StrategyPlan | null {
  const { pool, candles30m, binData, deposit, settings } = opts;
  const notes: string[] = [];

  const atrPct = computeAtr(candles30m, 14);
  const turnover24 = pool.tvl > 0 ? pool.vol24 / pool.tvl : 0;
  const turnover1h = pool.tvl > 0 ? pool.vol1h / pool.tvl : 0;

  if (pool.tvl < settings.minPoolTvl) return null;
  if (turnover24 < settings.minTurnover) return null;
  if (!atrPct || atrPct > settings.maxAtrPct) return null;

  // диапазон: 1.5 × ATR, но не шире maxRange и не уже 1%
  const halfRange = Math.min(settings.maxRangePct, Math.max(1.0, settings.rangeAtrMult * atrPct)) / 100;
  const priceRef = candles30m[candles30m.length - 1]?.c || pool.currentPrice;
  const step = Math.max(0.0005, pool.binStep / 10_000);

  // бины от -halfRange до +halfRange; капитал раскладываем по кривой, как Meteora:
  //   spot  — колокол вокруг активной цены (по умолчанию, максимум комиссий)
  //   curve — тяжелее к краям диапазона
  //   uniform — равномерно
  const layout = settings.distribution ?? "spot";
  const count = Math.max(4, Math.min(40, Math.round((2 * halfRange) / step)));
  const bins: PlanBin[] = [];
  for (let i = 0; i < count; i++) {
    const rel = -halfRange + ((i + 0.5) / count) * (2 * halfRange);
    bins.push({ k: Math.round(rel / step), priceRel: 1 + rel, weight: 0, usd: 0, poolUsd: 0, feePerDay: 0 });
  }
  // каждая сторона (выше/ниже цены) получает ровно 50% капитала, форма — по выбранной кривой
  for (const side of ["ask", "bid"] as const) {
    const part = bins.filter((b) => (side === "ask" ? b.priceRel > 1 : b.priceRel <= 1));
    if (!part.length) continue;
    const maxD = Math.max(...part.map((b) => Math.abs(b.priceRel - 1)));
    const raw = part.map((b) => {
      const x = Math.abs(b.priceRel - 1) / (maxD || 1);
      if (layout === "uniform") return 1;
      if (layout === "curve") return 0.3 + Math.pow(x, 2) * 0.7;
      return Math.exp(-0.5 * Math.pow(x / 0.6, 2)); // spot: колокол, σ ≈ 0.6 ширины стороны (как Spot в Meteora)
    });
    const sum = raw.reduce((a, b) => a + b, 0) || 1;
    // вес = 50% стороны × доля внутри стороны
    part.forEach((b, i) => (b.weight = (raw[i] / sum) * 0.5));
  }

  // ликвидность пула в нашем коридоре и «активный» TVL (±2%)
  const zoneBins = binData.bins.filter((b) => Math.abs(b.priceRel - 1) <= halfRange * 1.05);
  const rangeLiquidity = Math.max(
    0,
    zoneBins.reduce((s, b) => s + b.usd, 0) || (binData.source === "estimate" ? pool.tvl * 0.08 : 0),
  );
  const activeTvl = binData.bins
    .filter((b) => Math.abs(b.priceRel - 1) <= 0.02)
    .reduce((s, b) => s + b.usd, 0);

  // капитал: доля депозита, ограниченная риском и ликвидностью коридора
  const friction = settings.frictionPct / 100;
  const riskCap = (settings.maxLossPerTradePct / 100) * deposit / (halfRange + friction + 0.001);
  // не забираем больше 20% ликвидности коридора — иначе сами двигаем цену при выходе
  const liquidityCap = rangeLiquidity > 0 ? rangeLiquidity * 0.2 : deposit;
  const capital = Math.max(0, Math.min(deposit * (settings.budgetPct / 100), riskCap, liquidityCap));
  if (capital < 10) return null;
  if (rangeLiquidity > 0 && capital >= rangeLiquidity * 0.2 - 0.01) notes.push("капитал ограничен ликвидностью коридора");

  bins.forEach((b) => {
    b.usd = capital * b.weight;
    // ликвидность пула в ближайшем бине (в USD) — по ней считаем нашу долю комиссий
    let bestUsd = 0;
    let bestDist = Infinity;
    for (const p of binData.bins) {
      const d = Math.abs(p.priceRel - b.priceRel);
      if (d < bestDist) {
        bestDist = d;
        bestUsd = p.usd;
      }
    }
    b.poolUsd = Math.max(0, bestUsd);
  });

  // средняя цена входа: сколько токена куплено на каждый доллар (гармоническое среднее по ask-бинам)
  let tokenUsdAtEntry = 0;
  let tokenAmount = 0;
  for (const b of bins) {
    if (b.priceRel > 1) {
      tokenUsdAtEntry += b.usd;
      tokenAmount += b.usd / b.priceRel;
    }
  }
  const avgEntryPriceRel = tokenAmount > 0 ? tokenUsdAtEntry / tokenAmount : 1;

  const feeRate = ((pool.baseFeePct + pool.dynamicFeePct) * (1 - pool.protocolFeePct / 100)) / 100;
  const inRangeShare = volumeShareInRange(candles30m, priceRef, halfRange);
  // объём для комиссий: суточный — база, часовой только корректирует ±50%
  const hourlyExtrap = (pool.vol1h ?? 0) * 24;
  const volumeForFees = Math.min(Math.max(pool.vol24, hourlyExtrap * 0.5), pool.vol24 * 1.5);
  // фактические комиссии пула точнее модели «объём × ставка»: берём смесь горизонтов
  // (30 минут / час / сутки) — так прогноз совпадает с тем, что позиция реально зарабатывает
  const modeledFees24 = volumeForFees * feeRate;
  const rateParts: [number, number][] = [
    [(pool.fees30m ?? 0) * 48, 0.35],
    [(pool.fees1h ?? 0) * 24, 0.35],
    [pool.fees24 ?? 0, 0.3],
  ].filter(([v]) => v > 0) as [number, number][];
  let blended = pool.fees24 ?? 0;
  if (rateParts.length) {
    const wsum = rateParts.reduce((a, [, w]) => a + w, 0);
    blended = rateParts.reduce((a, [v, w]) => a + v * w, 0) / (wsum || 1);
  }
  if ((pool.fees24 ?? 0) > 0) blended = Math.min(Math.max(blended, pool.fees24 * 0.25), pool.fees24 * 2);
  const actualFees24 = blended > 0 ? blended : modeledFees24;
  const poolFees24 = Math.min(actualFees24, modeledFees24 * 1.5);
  const vInRange = poolFees24 * inRangeShare;
  // доля в комиссиях: взвешиваем по тому, где реально идёт объём (у активной цены, σ ≈ 2.5 бина),
  // иначе пик колокола занижает нашу долю в активных бинах
  let vW = 0;
  let vShare = 0;
  for (const b of bins) {
    const d = Math.abs(Math.log(b.priceRel)) / Math.log(1 + step);
    const w = Math.exp(-0.5 * Math.pow(d / 1.0, 2));
    const share = Math.min(0.5, b.usd / Math.max(1e-9, b.usd + b.poolUsd));
    vShare += w * share;
    vW += w;
  }
  const ourShare =
    vW > 0 && vShare > 0
      ? Math.min(0.5, vShare / vW)
      : capital / (rangeLiquidity + capital + 1e-9);

  // распределяем комиссию по бинам пропорционально весам и близости к центру
  const totalWeight = bins.reduce((s, b) => s + b.weight / (Math.abs(b.priceRel - 1) + step * 1.5), 0);
  bins.forEach((b) => {
    const w = (b.weight / (Math.abs(b.priceRel - 1) + step * 1.5)) / totalWeight;
    b.feePerDay = vInRange * ourShare * w * settings.utilization;
  });
  const dailyFees = bins.reduce((s, b) => s + b.feePerDay, 0);
  const expectedDailyPct = (dailyFees / capital) * 100;
  const expected15hPct = expectedDailyPct * (15 / 24);

  if (expectedDailyPct < 0.2) notes.push("низкий прогноз комиссий");
  if (expectedDailyPct > 15) notes.push("прогноз выше 15%/сут — проверьте оборот на накрутку");

  return {
    pool,
    atrPct,
    turnover24,
    turnover1h,
    txns24: 0,
    rangePct: halfRange,
    concentration: 1 / (2 * halfRange),
    bins,
    capital,
    feeRate,
    rangeLiquidity,
    activeTvl,
    inRangeShare,
    avgEntryPriceRel,
    distribution: layout,
    expectedDailyPct,
    expected15hPct,
    volumeForFees,
    notes,
    score: expected15hPct,
  };
}

/**
 * Стоимость позиции при текущей цене (rel = price / entryPrice) — модель DLMM:
 *  · бины выше цены входа держат токен, купленный по цене входа; когда цена проходит
 *    бин вверх — токен продаётся по цене бина и превращается в SOL;
 *  · бины ниже цены входа держат SOL; когда цена падает ниже бина — SOL
 *    конвертируется в токен по цене бина.
 * На границе ±range это даёт ровно ту просадку тела (IL), которую видно в Meteora.
 */
export function positionValue(
  bins: { priceRel: number; usd: number }[],
  rel: number,
): { value: number; tokenUsd: number; solUsd: number } {
  let tokenUsd = 0;
  let solUsd = 0;
  for (const b of bins) {
    if (b.priceRel > 1) {
      // ask: держит токен, пока цена не дошла до бина
      if (rel <= b.priceRel) tokenUsd += b.usd * rel;
      else solUsd += b.usd * b.priceRel;
    } else {
      // bid: держит SOL, пока цена не провалилась ниже бина
      if (rel >= b.priceRel) solUsd += b.usd;
      else tokenUsd += b.usd * (rel / b.priceRel);
    }
  }
  return { value: tokenUsd + solUsd, tokenUsd, solUsd };
}

/**
 * Ребаланс: закрываем, свопаем половину в другой актив, строим новую сетку.
 * Возвращает новый капитал и издержки свопа.
 */
export function rebalance(
  bins: { priceRel: number; usd: number }[],
  rel: number,
  frictionPct: number,
): { capital: number; frictionUsd: number } {
  const { value } = positionValue(bins, rel);
  const frictionUsd = value * (frictionPct / 100);
  return { capital: Math.max(0, value - frictionUsd), frictionUsd };
}

/** Что делать с позицией, вышедшей за границу сетки. */
export type RangeAction =
  | "none"
  | "mark_out"
  | "back_in"
  | "hold"
  | "rebalance"
  | "close_rotate"
  | "close_range_down";

/**
 * Единое правило выхода/ребаланса:
 *  • цена вышла за границу → помечаем время и ЖДЁМ graceMs (по умолчанию 10 минут);
 *  • вернулась внутрь → ничего не делаем;
 *  • не вернулась за graceMs → ребаланс;
 *  • позиция «ждёт ротации» (отработала срок) → закрываем только по возврату к центру (rel ≥ 1)
 *    или по пробою вниз, который держится дольше graceMs.
 */
export function decideRangeAction(opts: {
  rel: number;
  rangePct: number;
  outSince: number;
  now: number;
  graceMs: number;
  rotatePending: boolean;
}): RangeAction {
  const { rel, rangePct, outSince, now, graceMs, rotatePending } = opts;
  const out = rel > 1 + rangePct || rel < 1 - rangePct;
  const expired = outSince > 0 && now - outSince >= graceMs;

  if (rotatePending) {
    if (rel >= 1) return "close_rotate";
    if (out && rel < 1 - rangePct && expired) return "close_range_down";
  }

  if (!out) return outSince > 0 ? "back_in" : "none";
  if (outSince === 0) return "mark_out";
  return expired ? "rebalance" : "hold";
}
