import { splitPair, type Pool } from "./meteora.js";
import type { Candle } from "./market.js";
import { priceStats } from "./math.js";
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
  /** горизонт удержания, часы: на него масштабируется ATR при расчёте диапазона */
  rangeHorizonHours?: number;
  /** минимум/максимум бинов на сторону диапазона */
  minBinsPerSide?: number;
  maxBinsPerSide?: number;
  /** минимальная доходность пула fee/TVL, %/сутки */
  minFeeTvlPct?: number;
  /** минимальный размер позиции, $ */
  minPositionUsd?: number;
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

  // Доходность пула — главный фильтр. Проверяем и здесь, а не только в сканере,
  // иначе ручной вход из скринера и ребаланс проходят мимо него.
  const feeTvlPct = pool.feeTvl24h > 0 ? pool.feeTvl24h : pool.tvl > 0 ? (pool.fees24 / pool.tvl) * 100 : 0;
  const feeTvlMin = settings.minFeeTvlPct ?? 0;
  if (feeTvlMin > 0 && feeTvlPct < feeTvlMin) return null;

  // диапазон: ATR × √(горизонт/30м), снэпнутый к целым бинам (см. targetHalfRange/gridFor)
  const halfRangeRaw = targetHalfRange(atrPct, settings);
  const grid = gridFor(halfRangeRaw, pool.binStep, settings);
  if (!grid.ok) {
    // шаг бина слишком крупный для нужного диапазона: получилось бы < 9 бинов на сторону
    notes.push(
      `bin step ${pool.binStep} bps слишком крупный: диапазон ±${(halfRangeRaw * 100).toFixed(2)}% = ${Math.round(
        (halfRangeRaw * 10_000) / Math.max(1, pool.binStep),
      )} бинов на сторону (нужно ≥ ${settings.minBinsPerSide ?? 9})`,
    );
    return null;
  }
  const halfRange = grid.halfRange;
  // Диапазон обязан покрывать хотя бы 1.5 ATR: иначе позиция выходит из диапазона
  // в первую же свечу (именно это и происходило: ±1.5 ATR и медиана 28 минут).
  if (atrPct > 0 && halfRange < (2.0 * atrPct) / 100) {
    notes.push(
      `диапазон ±${(halfRange * 100).toFixed(2)}% покрывает только ${(halfRange * 100 / atrPct).toFixed(1)} ATR ` +
        `(нужно ≥2 при ATR ${atrPct.toFixed(2)}%) — позиция вылетит за 1–2 часа`,
    );
    return null;
  }
  const priceRef = candles30m[candles30m.length - 1]?.c || pool.currentPrice;
  const step = Math.max(0.0005, pool.binStep / 10_000);

  // бины от -halfRange до +halfRange; капитал раскладываем по кривой, как Meteora:
  //   spot  — колокол вокруг активной цены (по умолчанию, максимум комиссий)
  //   curve — тяжелее к краям диапазона
  //   uniform — равномерно
  const layout = settings.distribution ?? "spot";
  // Бины строим ровно по сетке пула: k = −N..N, цена бина = (1+step)^k.
  // Раньше позиции ставились по «непрерывной» шкале с округлением — центр сетки
  // уезжал на пол-бина, и модель не совпадала с реальными бинами в цепи.
  const N = Math.max(3, Math.min(35, grid.binsPerSide));
  const bins: PlanBin[] = [];
  for (let k = -N; k <= N; k++) {
    bins.push({ k, priceRel: Math.pow(1 + step, k), weight: 0, usd: 0, poolUsd: 0, feePerDay: 0 });
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
  if (capital < (settings.minPositionUsd ?? 10)) return null;
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

/**
 * Целевая половина диапазона из текущего ATR.
 * Одна формула и для входа, и для ребаланса, и для проактивной правки сетки:
 * диапазон сжимается/расширяется вместе с волатильностью, но не выходит за maxRangePct
 * и не становится уже 1%.
 */
export type RangeDynamics = {
  rangeAtrMult: number;
  maxRangePct: number;
  /** горизонт удержания позиции, часы — на него масштабируется ATR */
  rangeHorizonHours?: number;
  /** сколько бинов минимум должно быть в каждую сторону (иначе пул «слишком крупный шаг») */
  minBinsPerSide?: number;
  /** верхняя граница бинов на сторону (программа даёт 70 бинов на позицию по умолчанию) */
  maxBinsPerSide?: number;
};

/**
 * Целевая половина диапазона, в долях цены.
 *
 * Ошибка, которую это исправляет: раньше диапазон был `1.5 × ATR(30m)` — то есть
 * 1.5 размаха ОДНОЙ 30-минутной свечи. По журналу 27–28.10 медиана до первого выхода
 * из диапазона составила 28 минут при 85 % позиций, вылетевших за час.
 *
 * Размах цены растёт как корень из времени, поэтому ATR масштабируется на
 * √(горизонт / 30 мин). При горизонте 4 ч это ×2.83: диапазон становится
 * в 2.8 раза шире и живёт в ~8 раз дольше (28 мин → 3–4 ч).
 *
 * Границы: не уже 1.5 % (иначе шум выбивает мгновенно) и не шире maxRangePct.
 */
export function targetHalfRange(
  atrPct: number,
  settings: Pick<StrategySettings, "rangeAtrMult" | "maxRangePct"> & {
    rangeHorizonHours?: number;
  },
): number {
  const horizon = Math.max(0.5, settings.rangeHorizonHours ?? 4);
  const scaled = settings.rangeAtrMult * Math.max(0, atrPct) * Math.sqrt(horizon / 0.5);
  const pct = Math.min(settings.maxRangePct, Math.max(1.5, scaled));
  return pct / 100;
}

/**
 * Привязка диапазона к сетке бинов.
 *
 * Вторая ошибка: ширина диапазона задавалась в процентах, а число бинов получалось
 * случайным (8 при bin step 25 bps и ±1 %, 50 при bin step 5 bps и ±1 %). 8 бинов —
 * это Spot-Concentrated по классификации Meteora, то есть максимальный риск выхода.
 * Теперь диапазон снэпится к целым бинам и держится в коридоре 18–70 бинов.
 */
export function gridFor(
  halfRange: number,
  binStepBps: number,
  settings: { minBinsPerSide?: number; maxBinsPerSide?: number },
): { binsPerSide: number; halfRange: number; totalBins: number; ok: boolean } {
  const step = Math.max(0.0001, binStepBps / 10_000);
  const want = Math.round(halfRange / step);
  const min = Math.max(3, Math.round(settings.minBinsPerSide ?? 9));
  const max = Math.max(min, Math.round(settings.maxBinsPerSide ?? 35));
  const binsPerSide = Math.min(max, Math.max(min, want));
  return {
    binsPerSide,
    halfRange: binsPerSide * step,
    totalBins: binsPerSide * 2 + 1,
    // пул годится, только если для целевого диапазона реально нужно ≥ min бинов на сторону
    ok: want >= min,
  };
}

export type FilterCheck = {
  key: string;
  label: string;
  ok: boolean;
  value: number;
  limit: number;
  unit: string;
  severity: "hard" | "soft";
  note?: string;
};

export type PoolHealth = {
  verdict: "ok" | "soft" | "hard";
  checks: FilterCheck[];
  failed: FilterCheck[];
  warn: FilterCheck[];
  atrPct: number;
  atrAtEntry: number;
  atrDriftPct: number;
  turnover24: number;
  turnover1h: number;
  /** доходность пула: комиссии за сутки на доллар TVL, % */
  feeTvlPct: number;
  tvl: number;
  vol1h: number;
  rangePctNow: number;
  rangePctTarget: number;
  rangeDriftPct: number;
  inRangeShare: number;
  change24h: number;
  /** короткая подпись состояния — для журнала и дедупликации записей */
  signature: string;
};

/**
 * Пересмотр пула теми же жёсткими фильтрами, что и на входе.
 *
 * Зачем: позиция живёт часами, а рынок меняется — ATR растёт, оборот падает,
 * TVL утекает. Раньше бот держал позицию «по инерции» и ребалансировал вслепую.
 * Теперь перед каждым ребалансом (и периодически в тике) пул проверяется заново:
 *  • hard — условия входа больше не выполняются → выходим (EXIT_FILTERS);
 *  • soft — работать можно, но сетку стоит поправить (RANGE_ADJUST);
 *  • ok — всё как при входе.
 *
 * Допуск по ATR (atrTolerancePct) нужен, чтобы не выходить из-за одного
 * «шумного» дня: выход происходит, когда ATR превысил лимит входа с запасом.
 */
export function evaluatePoolHealth(opts: {
  pool: Pool;
  candles30m: Candle[];
  settings: StrategySettings & {
    minVol1h?: number;
    minAgeHours?: number;
    minHolders?: number;
    maxTurnover?: number;
    minFeeTvlPct?: number;
  };
  /** ATR на момент входа/последнего ребаланса — база для оценки дрейфа */
  atrAtEntry: number;
  /** текущая половина диапазона */
  rangePct: number;
  atrTolerancePct?: number;
  now?: number;
}): PoolHealth {
  const { pool, candles30m, settings } = opts;
  const now = opts.now ?? Date.now();
  const checks: FilterCheck[] = [];
  const add = (c: FilterCheck) => checks.push(c);

  const haveCandles = candles30m.length >= 16;
  const atrPct = haveCandles ? computeAtr(candles30m, 14) : 0;
  const turnover24 = pool.tvl > 0 ? pool.vol24 / pool.tvl : 0;
  const turnover1h = pool.tvl > 0 ? pool.vol1h / pool.tvl : 0;
  const stats = haveCandles ? priceStats(candles30m) : { change24h: 0, atrPct: 0, rug: false };
  const token = splitPair(pool).token;

  const tol = Math.max(0, opts.atrTolerancePct ?? 0) / 100;
  const atrLimit = settings.maxAtrPct * (1 + tol);

  add({
    key: "data",
    label: "Данные свечей",
    ok: haveCandles && atrPct > 0,
    value: candles30m.length,
    limit: 16,
    unit: "свечей",
    severity: "hard",
    note: haveCandles ? undefined : "нет свечей 30m — оценивать нечем",
  });
  add({
    key: "tvl",
    label: "TVL пула",
    ok: pool.tvl >= settings.minPoolTvl,
    value: pool.tvl,
    limit: settings.minPoolTvl,
    unit: "$",
    severity: "hard",
  });
  add({
    key: "turnover",
    label: "Оборот Vol/TVL",
    ok: turnover24 >= settings.minTurnover,
    value: turnover24,
    limit: settings.minTurnover,
    unit: "x",
    severity: "hard",
  });
  // ── доходность пула: главный фильтр, который у нас отсутствовал.
  // Пулы с fee/TVL 0.5–1.3 %/сут не окупают даже один ребаланс (12–30 часов на круг),
  // поэтому «просадка вместо комиссий» была предопределена ещё на входе.
  const feeTvlPct = pool.feeTvl24h > 0 ? pool.feeTvl24h : pool.tvl > 0 ? (pool.fees24 / pool.tvl) * 100 : 0;
  const feeTvlMin = settings.minFeeTvlPct ?? 0;
  if (feeTvlMin > 0) {
    add({
      key: "feeTvl",
      label: "Доходность fee/TVL",
      ok: feeTvlPct >= feeTvlMin * 0.6,
      value: feeTvlPct,
      limit: feeTvlMin * 0.6,
      unit: "%/сут",
      severity: "hard",
      note:
        feeTvlPct < feeTvlMin
          ? `ниже нормы ${feeTvlMin}%/сут — позиция не окупает обслуживание`
          : undefined,
    });
    add({
      key: "feeTvlSoft",
      label: "Доходность на уровне входа",
      ok: feeTvlPct >= feeTvlMin,
      value: feeTvlPct,
      limit: feeTvlMin,
      unit: "%/сут",
      severity: "soft",
      note: feeTvlPct < feeTvlMin ? "пул подешевел по комиссиям" : undefined,
    });
  }

  // покрывает ли текущий диапазон волатильность (1.5 ATR) — при росте ATR
  // позиция перестаёт быть осмысленной даже без пробоя
  {
    const covers = opts.rangePct >= (2.0 * atrPct) / 100;
    add({
      key: "rangeCoversAtr",
      label: "Диапазон покрывает ATR",
      ok: covers,
      value: opts.rangePct * 100,
      limit: 2.0 * atrPct,
      unit: "%",
      severity: "hard",
      note: covers ? undefined : "волатильность выросла выше ширины сетки — позиция не успевает зарабатывать",
    });
  }

  add({
    key: "atr",
    label: "ATR(30m)",
    ok: atrPct <= atrLimit,
    value: atrPct,
    limit: atrLimit,
    unit: "%",
    severity: "hard",
    note:
      atrPct > settings.maxAtrPct
        ? `выше лимита входа ${settings.maxAtrPct}% (допуск ${Math.round((opts.atrTolerancePct ?? 0) * 10) / 10}% → выход при >${atrLimit.toFixed(2)}%)`
        : undefined,
  });
  if ((settings.minVol1h ?? 0) > 0) {
    add({
      key: "vol1h",
      label: "Объём за час",
      ok: pool.vol1h >= settings.minVol1h!,
      value: pool.vol1h,
      limit: settings.minVol1h!,
      unit: "$",
      severity: "hard",
    });
  }
  if ((settings.minHolders ?? 0) > 0) {
    add({
      key: "holders",
      label: "Держатели токена",
      ok: (token.holders ?? 0) >= settings.minHolders!,
      value: token.holders ?? 0,
      limit: settings.minHolders!,
      unit: "чел.",
      severity: "hard",
    });
  }
  if ((settings.minAgeHours ?? 0) > 0) {
    add({
      key: "age",
      label: "Возраст пула",
      ok: now - pool.createdAt >= settings.minAgeHours! * 3600_000,
      value: (now - pool.createdAt) / 3600_000,
      limit: settings.minAgeHours!,
      unit: "ч",
      severity: "hard",
    });
  }
  add({
    key: "rug",
    label: "Падение за сутки",
    ok: stats.change24h > -45,
    value: stats.change24h,
    limit: -45,
    unit: "%",
    severity: "hard",
    note: stats.rug ? "rug-фильтр: цена упала больше 45%" : undefined,
  });

  // ── мягкие сигналы: работаем, но сетку пора править
  const hotCap = Math.min(60, (settings.maxTurnover ?? 60) * 1.5);
  add({
    key: "heat",
    label: "Перегрев оборота",
    ok: turnover24 <= hotCap,
    value: turnover24,
    limit: hotCap,
    unit: "x",
    severity: "soft",
    note: "оборот аномально высокий — риск резкого слива ликвидности",
  });
  const inRangeShare = haveCandles ? volumeShareInRange(candles30m, pool.currentPrice, opts.rangePct) : 1;
  add({
    key: "inRange",
    label: "Объём внутри коридора",
    ok: inRangeShare >= 0.45,
    value: inRangeShare * 100,
    limit: 45,
    unit: "%",
    severity: "soft",
    note: "мало объёма внутри диапазона — сетка слишком узкая",
  });

  const failed = checks.filter((c) => !c.ok && c.severity === "hard");
  const warn = checks.filter((c) => !c.ok && c.severity === "soft");
  const verdict: PoolHealth["verdict"] = failed.length ? "hard" : warn.length ? "soft" : "ok";

  const rangePctTarget = targetHalfRange(atrPct, settings);
  const atrDriftPct = opts.atrAtEntry > 0 ? ((atrPct - opts.atrAtEntry) / opts.atrAtEntry) * 100 : 0;
  const rangeDriftPct = opts.rangePct > 0 ? ((rangePctTarget - opts.rangePct) / opts.rangePct) * 100 : 0;

  const signature = [
    verdict,
    ...failed.map((c) => c.key),
    ...warn.map((c) => c.key),
    `atr${atrPct.toFixed(1)}`,
    `ftv${feeTvlPct.toFixed(1)}`,
    `rng${(rangePctTarget * 100).toFixed(1)}`,
  ].join("|");

  return {
    verdict,
    checks,
    failed,
    warn,
    atrPct,
    atrAtEntry: opts.atrAtEntry,
    atrDriftPct,
    turnover24,
    turnover1h,
    feeTvlPct,
    tvl: pool.tvl,
    vol1h: pool.vol1h,
    rangePctNow: opts.rangePct,
    rangePctTarget,
    rangeDriftPct,
    inRangeShare,
    change24h: stats.change24h,
    signature,
  };
}
