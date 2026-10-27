import type { Candle } from "./market.js";
import type { Pool } from "./meteora.js";
import type { BinLiquidity } from "./chain.js";

export type Zone = { lowRel: number; highRel: number };

export type Plan = {
  pool: Pool;
  feeRate: number;
  zones: { z1: Zone; z2: Zone };
  inRangeShare: number;
  rangeLiquidity: number;
  activeTvl: number;
  turnover24Pct: number;
  turnover1hPct: number;
  volForFees: number;
  capital: number;
  pAvgRel: number;
  exitRel: number;
  worstLossUsd: number;
  worstLossPctOfDeposit: number;
  rDayPct: number;
  r15hPct: number;
  predictedFees15h: number;
  bins: { k: number; priceRel: number; weight: number; usd: number; feePerDay: number }[];
  volumeProfile: { priceRel: number; vol: number }[];
  score: number;
  notes: string[];
  source: "chain" | "estimate";
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Профиль объёма по цене. priceRef — цена в тех же единицах, что и свечи (USD). */
export function buildVolumeProfile(candles: Candle[], step: number, priceRef: number) {
  const buckets = new Map<number, number>();
  const keyOf = (rel: number) => Math.round(rel / step) * step;
  const safeStep = Math.max(step, 0.0005);
  for (const c of candles) {
    if (!Number.isFinite(c.l) || !Number.isFinite(c.h) || c.c <= 0) continue;
    const lo = c.l / priceRef - 1;
    const hi = c.h / priceRef - 1;
    if (Math.abs(lo) > 3 || Math.abs(hi) > 3) continue;
    const nb = Math.max(1, Math.min(40, Math.round((hi - lo) / safeStep)));
    const share = c.v / nb;
    for (let i = 0; i < nb; i++) {
      const rel = lo + ((i + 0.5) / nb) * (hi - lo);
      const key = keyOf(rel);
      buckets.set(key, (buckets.get(key) ?? 0) + share);
    }
  }
  const arr = [...buckets.entries()].map(([priceRel, vol]) => ({ priceRel, vol }));
  arr.sort((a, b) => b.priceRel - a.priceRel);
  return arr;
}

function smooth(profile: { priceRel: number; vol: number }[]) {
  return profile.map((p, i) => {
    const nb = [profile[i - 1], p, profile[i + 1]].filter(Boolean) as { vol: number }[];
    return { ...p, vol: nb.reduce((s, x) => s + x.vol, 0) / nb.length };
  });
}

/** Два узла объёма снизу от цены: рабочая зона и зона усреднения. */
export function pickZones(profileIn: { priceRel: number; vol: number }[], step: number) {
  const profile = smooth(profileIn);
  const below = profile.filter((p) => p.priceRel < -0.005 && p.priceRel > -0.25);
  const findPeak = (fromRel: number, toRel: number) => {
    const seg = below.filter((p) => p.priceRel <= fromRel && p.priceRel >= toRel);
    if (!seg.length) return null;
    return seg.reduce((a, b) => (b.vol > a.vol ? b : a));
  };
  const peak1 = findPeak(-0.01, -0.07) ?? findPeak(-0.005, -0.14) ?? below[0];
  const p1 = peak1?.priceRel ?? -0.025;

  const peak2 = findPeak(p1 - 0.012, Math.max(-0.22, p1 - 0.1)) ?? below.find((p) => p.priceRel < p1 - 0.012);
  const p2 = peak2?.priceRel ?? p1 - 0.035;

  return { p1, p2, step, profile };
}

/** Собираем план сделки. Все проценты — относительно текущей цены. */
export function analyze(opts: {
  pool: Pool;
  candles: Candle[];
  binData: { activePrice: number; bins: BinLiquidity[]; source: "chain" | "estimate" };
  deposit: number;
  maxCapitalSharePct: number;
  maxDdPerTradePct: number;
  targetHours: number;
  exitCostPct: number;
  utilization: number;
  /** Объём для прогноза комиссий: часовой поток важнее среднесуточного. */
  volForFees?: number;
}): Plan {
  const { pool, candles, binData } = opts;
  const step = Math.max(0.0005, pool.binStep / 10_000);
  const lastClose = candles[candles.length - 1]?.c || pool.currentPrice || 1;
  const priceRef = lastClose;
  const profile = buildVolumeProfile(candles, step, priceRef);
  const { p1, p2 } = pickZones(profile, step);
  const notes: string[] = [];
  if (binData.source === "estimate") notes.push("цепь недоступна: T_r оценена по TVL");

  const totalVol = profile.reduce((s, p) => s + p.vol, 0) || 1;
  const volAt = (relLo: number, relHi: number) =>
    profile.filter((p) => p.priceRel >= relLo && p.priceRel <= relHi).reduce((s, p) => s + p.vol, 0);

  const feeRate = ((pool.baseFeePct + pool.dynamicFeePct) * (1 - pool.protocolFeePct / 100)) / 100;
  const volForFees = opts.volForFees && opts.volForFees > 0 ? opts.volForFees : pool.vol24;
  // «Активный TVL» — ликвидность в пределах ±2% от цены (как считает Meteora UI)
  const activeTvl = binData.bins
    .filter((b) => Math.abs(b.priceRel - 1) <= 0.02)
    .reduce((s, b) => s + b.usd, 0);
  const exitCost = opts.exitCostPct / 100;

  // Перебираем несколько ширин сеток и выбираем лучшую по критерию
  // «доходность при соблюдении лимита риска».
  const widths: { z1: number; z2: number }[] = [
    { z1: 0.6, z2: 1.0 },
    { z1: 1.0, z2: 1.0 },
    { z1: 1.0, z2: 1.6 },
    { z1: 1.6, z2: 2.2 },
  ];

  let best: Plan | null = null;
  for (const w of widths) {
    const z1: Zone = {
      lowRel: clamp(p1 - 1.5 * step * w.z1, -0.25, -0.002),
      highRel: Math.min(0, -step * 0.5),
    };
    const z2: Zone = {
      lowRel: clamp(p2 - 1.5 * step * w.z2, -0.3, z1.lowRel - 0.004),
      highRel: z1.lowRel,
    };
    const inRangeShare = clamp(volAt(z2.lowRel, z1.highRel) / totalVol, 0.01, 0.99);

    // бины цепи в наших зонах (priceRel ≈ 1 + rel)
    const zoneBins = binData.bins.filter((b) => {
      const rel = b.priceRel - 1;
      return rel >= z2.lowRel && rel <= z1.highRel;
    });
    const rangeLiquidity = Math.max(
      zoneBins.reduce((s, b) => s + b.usd, 0),
      binData.source === "estimate" ? pool.tvl * 0.05 : 0,
    );

    const exitRel = 1 + z2.lowRel - step; // множитель цены (например 0.94)
    // средняя цена: сначала по бинам цепи, иначе — по равномерной сетке
    const relPrices = zoneBins.length
      ? zoneBins.map((b) => b.priceRel)
      : Array.from({ length: Math.max(3, Math.round((z1.highRel - z2.lowRel) / step)) }, (_, i) => 1 - (i + 0.5) * step);
    const pAvgRel = 1 / relPrices.reduce((s, p) => s + 1 / Math.max(0.5, p), 0) * relPrices.length;
    const lossFrac = Math.max(0.002, 1 - exitRel / pAvgRel);

    const riskCap = ((opts.maxDdPerTradePct / 100) * opts.deposit) / (lossFrac + exitCost);
    const shareCap = (opts.maxCapitalSharePct / 100) * opts.deposit;
    const capital = Math.max(0, Math.min(riskCap, rangeLiquidity > 0 ? rangeLiquidity : shareCap, shareCap));

    const ourShare = capital / (rangeLiquidity + capital + 1e-9);
    const inRangeVolUsd = volForFees * inRangeShare;
    const dayFees = inRangeVolUsd * feeRate * ourShare * opts.utilization;
    const rDayPct = capital > 0 ? (dayFees / capital) * 100 : 0;
    const r15hPct = rDayPct * (opts.targetHours / 24);
    const worstLossUsd = capital * (lossFrac + exitCost);

    // веса: больше капитала туда, где больше объём и меньше чужая ликвидность
    const weighted = zoneBins.map((b) => {
      const rel = b.priceRel - 1;
      const v = profile.find((p) => Math.abs(p.priceRel - rel) <= step * 1.5)?.vol ?? totalVol / 1000;
      return { b, raw: Math.max(1e-9, v) / (b.usd + 50) };
    });
    const sumRaw = weighted.reduce((s, x) => s + x.raw, 0) || 1;
    const bins = weighted.map(({ b, raw }) => ({
      k: b.k,
      priceRel: b.priceRel,
      weight: Math.min(raw / sumRaw, 0.35),
      usd: 0,
      feePerDay: 0,
    }));
    const norm = bins.reduce((s, b) => s + b.weight, 0) || 1;
    bins.forEach((b) => {
      b.weight = b.weight / norm;
      b.usd = b.weight * capital;
    });

    // Комиссии считаем ПО БИНАМ: объём этого бина × ставка × наша доля в его ликвидности.
    const totalProfileVol = profile.reduce((s, x) => s + x.vol, 0) || 1;
    bins.forEach((bin) => {
      const rel = bin.priceRel - 1;
      const volBin = profile.find((x) => Math.abs(x.priceRel - rel) <= step * 1.2)?.vol ?? 0;
      const shareOfPoolVol = volBin / totalProfileVol;
      const binTotal = (zoneBins.find((z) => z.k === bin.k)?.usd ?? 0) + bin.usd;
      const ourShare = binTotal > 0 ? bin.usd / binTotal : 0;
      bin.feePerDay = volForFees * shareOfPoolVol * feeRate * ourShare * opts.utilization;
    });

    const plan: Plan = {
      pool,
      feeRate,
      zones: { z1, z2 },
      inRangeShare,
      rangeLiquidity,
      activeTvl,
      turnover24Pct: pool.tvl > 0 ? (pool.vol24 / pool.tvl) * 100 : 0,
      turnover1hPct: pool.tvl > 0 ? (pool.vol1h / pool.tvl) * 100 : 0,
      volForFees,
      capital,
      pAvgRel,
      exitRel,
      worstLossUsd,
      worstLossPctOfDeposit: (worstLossUsd / opts.deposit) * 100,
      rDayPct,
      r15hPct,
      predictedFees15h: dayFees * (opts.targetHours / 24),
      bins,
      volumeProfile: profile,
      score: r15hPct,
      notes,
      source: binData.source,
    };

    const riskOk = plan.worstLossPctOfDeposit <= opts.maxDdPerTradePct + 0.01;
    const bestRiskOk = best ? best.worstLossPctOfDeposit <= opts.maxDdPerTradePct + 0.01 : false;
    if (!best || (riskOk && (!bestRiskOk || plan.score > best.score)) || (!riskOk && !bestRiskOk && plan.score > best.score)) {
      best = plan;
    }
  }

  return best!;
}

/**
 * Быстрый пре-ранк: сколько комиссий пул платит на единицу ликвидности СЕЙЧАС.
 * Раньше здесь был штраф за «неидеальное» отношение TVL/объём — из-за него
 * отбрасывались как раз самые активные пулы (оборот 800%+ в сутки).
 */
export function preRankScore(pool: Pool) {
  const fee = ((pool.baseFeePct + pool.dynamicFeePct) * (1 - pool.protocolFeePct / 100)) / 100;
  const turnover24 = pool.tvl > 0 ? pool.vol24 / pool.tvl : 0;
  const turnover1h = pool.tvl > 0 ? pool.vol1h / pool.tvl : 0;
  // часовой поток весит больше: он показывает, что происходит прямо сейчас
  return fee * (turnover24 * 0.4 + turnover1h * 24 * 0.6) * 100;
}

export function priceStats(candles: Candle[]) {
  if (candles.length < 4) return { change24h: 0, atrPct: 0, rug: false };
  const first = candles[0].o;
  const last = candles[candles.length - 1].c;
  const change24h = (last / first - 1) * 100;
  const atr =
    candles.slice(-48).reduce((s, c) => s + (c.h - c.l) / c.c, 0) / Math.min(48, candles.length);
  return { change24h, atrPct: atr * 100, rug: change24h < -45 };
}
