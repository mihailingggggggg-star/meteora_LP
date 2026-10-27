import { env } from "./env.js";
import { db, event, getSetting, setSetting } from "./db.js";
import { journal, readJournal, type JournalType } from "./journal.js";
import { fetchPools, fetchPool, isSolPair, splitPair, type Pool } from "./meteora.js";
import { fetchCandles, fetchGeckoPool, fetchMeteoraCandles, jupiterQuote, type Candle } from "./market.js";
import { readBinLiquidity } from "./chain.js";
import { SwapWatcher, resolveCreator } from "./swaps.js";
import { buildVolumeProfile, priceStats } from "./math.js";
import {
  buildBalancedPlan,
  computeAtr,
  positionValue,
  volumeShareInRange,
  type StrategyPlan,
  type StrategySettings,
} from "./strategy.js";

export type Mode = "demo" | "live";

type RtBin = { k: number; priceRel: number; usd: number; poolUsd: number; feePerDay: number };

type RtPos = {
  id: number;
  pool: Pool;
  tokenSymbol: string;
  tokenMint: string;
  tokenDecimals: number;
  tokenPriceUsd: number;
  solPriceUsd: number;
  tokenIsX: boolean;
  capital: number;
  initialCapital: number;
  frictionPaid: number;
  /** объём последней 30-минутной свечи (USD) */
  vol30m: number;
  entryPrice: number;
  /** средняя цена входа токеновой части относительно центра сетки */
  avgEntryRel: number;
  rangePct: number;
  bins: RtBin[];
  filled: Set<number>;
  feesAccrued: number;
  feesClaimed: number;
  claimedAt: number;
  openedAt: number;
  lastPrice: number;
  lastTick: number;
  lastAllocAt: number;
  rebalances: number;
  consecutiveLosses: number;
  lastRebalanceAt: number;
  breakChecks: number;
  lowConditionChecks: number;
  ticks: number;
  priceHist: number[];
  lastApiPrice: number;
  lastApiAt: number;
  atrPct: number;
  turnover24: number;
  predictedDailyPct: number;
  /** доля объёма пула, проходящего внутри нашего коридора (обновляется раз в 5 мин) */
  inRangeShare: number;
  /** суммарная ликвидность пула в нашем коридоре (USD) — снимок для доли комиссий */
  poolUsdInGrid: number;
  /** сглаженный run-rate комиссий пула ($/сутки) */
  feeRateEma: number;
  /** текущая доходность комиссий, %/сутки на капитал позиции */
  liveDailyPct: number;
  /** эффективная доля в комиссиях пула (взвешена по объёму у активной цены) */
  feeShareEff: number;
  lastBinsAt: number;
  solUsd: number;
  tokenUsd: number;
  positionValue: number;
  equity: number;
};

type LogLine = { ts: number; type: string; text: string };

type TfConf = {
  gecko: { timeframe: "minute" | "hour" | "day"; aggregate: number; limit: number };
  meteora?: { timeframe: "5m" | "30m" | "1h" | "2h" | "4h" | "12h" | "24h"; hours: number };
};

const TF_MAP: Record<string, TfConf> = {
  "1m": { gecko: { timeframe: "minute", aggregate: 1, limit: 180 }, meteora: { timeframe: "5m", hours: 12 } },
  "5m": { gecko: { timeframe: "minute", aggregate: 5, limit: 288 } },
  "30m": { gecko: { timeframe: "minute", aggregate: 30, limit: 288 }, meteora: { timeframe: "30m", hours: 96 } },
  "1h": { gecko: { timeframe: "hour", aggregate: 1, limit: 336 }, meteora: { timeframe: "1h", hours: 168 } },
  "4h": { gecko: { timeframe: "hour", aggregate: 4, limit: 300 }, meteora: { timeframe: "4h", hours: 720 } },
  "1d": { gecko: { timeframe: "day", aggregate: 1, limit: 200 }, meteora: { timeframe: "24h", hours: 2000 } },
};

export const swapWatcher = new SwapWatcher();

export class Engine {
  mode: Mode = env.mode;
  running = true;
  halted = false;
  haltReason: string | null = null;

  deposit = env.demoDeposit;
  cash = env.demoDeposit;
  positions: RtPos[] = [];
  banked = 0;
  nextMilestone = env.demoDeposit * 1.1;

  lastScanAt = 0;
  scanning = false;
  candidates: any[] = [];
  logs: LogLine[] = [];
  poolListCache: { at: number; pools: Pool[] } = { at: 0, pools: [] };
  candlesCache = new Map<string, { at: number; candles: Candle[] }>();
  candleFlight = new Map<string, Promise<Candle[]>>();
  analysisCache = new Map<string, { at: number; price: number; vol24: number; deposit: number; plan: StrategyPlan }>();
  private atrSeen = new Map<string, { at: number; atr: number }>();
  private lastSnapshotAt = 0;
  private scoreSeen = new Map<string, { score: number; at: number }>();
  private lastSummaryAt = 0;
  private lastSkipAt = 0;
  private haltDay = "";
  private rotCandidate: string | null = null;
  private rotChecks = 0;
  cooldownUntil = 0;
  blockedPools = new Map<string, number>();

  settings: StrategySettings & {
    minVol1h: number;
    minAgeHours: number;
    consecutiveLossStop: number;
    maxDailyLossPct: number;
    targetDailyPct: number;
    maxPositions: number;
    maxRebalancesPerDay: number;
    earlyExitTurnover: number;
    earlyExitAtrPct: number;
    profitTakePct: number;
    scanIntervalSeconds: number;
    claimIntervalHours: number;
    maxHoldHours: number;
  } = {
    maxAtrPct: env.strategy.maxAtrPct,
    minTurnover: env.strategy.minTurnover,
    minPoolTvl: env.strategy.minPoolTvl,
    minTxns24h: env.strategy.minTxns24h,
    minHolders: env.strategy.minHolders,
    minVol1h: env.strategy.minVol1h,
    minAgeHours: env.strategy.minAgeHours,
    consecutiveLossStop: env.strategy.consecutiveLossStop,
    maxDailyLossPct: env.strategy.maxDailyLossPct,
    rangeAtrMult: env.strategy.rangeAtrMult,
    maxRangePct: env.strategy.maxRangePct,
    budgetPct: env.strategy.budgetPct,
    frictionPct: env.strategy.frictionPct,
    maxLossPerTradePct: env.strategy.maxLossPerTradePct,
    utilization: env.strategy.utilization,
    targetDailyPct: env.strategy.targetDailyPct,
    maxPositions: env.strategy.maxPositions,
    maxRebalancesPerDay: env.strategy.maxRebalancesPerDay,
    earlyExitTurnover: env.strategy.earlyExitTurnover,
    earlyExitAtrPct: env.strategy.earlyExitAtrPct,
    profitTakePct: env.strategy.profitTakePct,
    scanIntervalSeconds: env.strategy.scanIntervalSeconds,
    claimIntervalHours: env.strategy.claimIntervalHours ?? 2,
    maxHoldHours: env.strategy.maxHoldHours,
  };

  /** Сколько позиций держим одновременно: 1 до $10k, дальше — диверсификация. */
  get slots(): number {
    const base = this.settings.maxPositions;
    if (this.deposit >= env.strategy.diversifyFromUsd) {
      return Math.max(base, env.strategy.maxPositionsLarge);
    }
    return base;
  }

  constructor() {
    const saved = getSetting<any>("engine.state", null);
    if (saved) {
      this.deposit = saved.deposit ?? this.deposit;
      this.cash = saved.cash ?? this.cash;
      this.halted = saved.halted ?? false;
      this.banked = saved.banked ?? 0;
      this.nextMilestone = saved.nextMilestone ?? this.deposit * 1.1;
    }
    const savedSettings = getSetting<any>("engine.settings", null);
    if (savedSettings) this.settings = { ...this.settings, ...savedSettings };
    this.restore();
    this.reconcile();
    this.seedLogs();
    journal(
      "BOOT",
      `движок запущен mode=${this.mode} deposit=$${this.deposit.toFixed(2)} стратегия=grid±${(this.settings.maxRangePct / 2).toFixed(1)}% ребаланс=${this.settings.maxRebalancesPerDay}/сут`,
    );
  }

  /** Лента «последние действия» не должна быть пустой после рестарта. */
  private seedLogs() {
    try {
      const d = new Date();
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const lines = readJournal(key, 60);
      const parsed: LogLine[] = [];
      for (const line of lines) {
        const m = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\]\s+(\S+)\s+(.*)$/);
        if (!m) continue;
        const type = m[4];
        if (type === "SCAN" || type === "REJECT" || type === "SCORE") continue;
        const ts = new Date(d);
        ts.setHours(Number(m[1]), Number(m[2]), Number(m[3]), 0);
        parsed.push({ ts: ts.getTime(), type, text: m[5] });
      }
      this.logs = parsed.slice(-24).reverse();
    } catch {
      /* журнал недоступен — не критично */
    }
  }

  private persist() {
    setSetting("engine.state", {
      deposit: this.deposit,
      cash: this.cash,
      halted: this.halted,
      banked: this.banked,
      nextMilestone: this.nextMilestone,
    });
  }

  private log(type: string, text: string) {
    this.logs.unshift({ ts: Date.now(), type, text });
    if (this.logs.length > 300) this.logs.pop();
  }

  // ─────────────────────────── restore / reconcile

  private restore() {
    const rows = db
      .prepare(`SELECT * FROM positions WHERE status = 'open' AND mode = ? ORDER BY id DESC`)
      .all(this.mode) as any[];
    for (const row of rows) {
      try {
        const bins = JSON.parse(row.bins || "[]");
        this.positions.push({
          id: row.id,
          pool: {
            address: row.pool,
            name: row.pool_name,
            tvl: 0,
            vol24: row.vol24 ?? 0,
            vol1h: 0,
            binStep: 100,
            baseFeePct: 0,
            dynamicFeePct: 0,
            protocolFeePct: 0,
            createdAt: 0,
            currentPrice: row.entry_price,
            tokenX: { address: "", symbol: "", price: 0, decimals: 9, holders: 0, freezeDisabled: true, verified: true, marketCap: 0, totalSupply: 0 },
            tokenY: { address: "", symbol: "", price: 0, decimals: 9, holders: 0, freezeDisabled: true, verified: true, marketCap: 0, totalSupply: 0 },
            isBlacklisted: false,
            launchpad: "",
            feeTvl24h: 0,
          } as any,
          tokenSymbol: row.token_symbol,
          tokenMint: row.token_mint,
          tokenDecimals: 9,
          tokenPriceUsd: 0,
          solPriceUsd: 0,
          tokenIsX: true,
          capital: row.capital,
          initialCapital: row.initial_capital ?? row.capital,
          frictionPaid: row.friction_usd ?? 0,
          vol30m: 0,
          entryPrice: row.entry_price,
          avgEntryRel: 1,
          rangePct: row.range_pct ?? 0.025,
          bins,
          filled: new Set<number>(),
          feesAccrued: row.fees_usd ?? 0,
          feesClaimed: row.claimed_usd ?? 0,
          claimedAt: row.last_claim_at ?? Date.now(),
          openedAt: row.opened_at,
          lastPrice: row.last_price ?? row.entry_price,
          lastTick: Date.now(),
          lastAllocAt: 0,
          rebalances: row.rebalances ?? 0,
          consecutiveLosses: row.consecutive_losses ?? 0,
          lastRebalanceAt: 0,
          breakChecks: 0,
          lowConditionChecks: 0,
          ticks: 0,
          priceHist: [row.last_price ?? row.entry_price],
          lastApiPrice: 0,
          lastApiAt: 0,
          atrPct: row.atr_pct ?? 0,
          turnover24: row.turnover24 ?? 0,
          predictedDailyPct: row.predicted_15h ? (row.predicted_15h * 24) / 15 : 0,
          inRangeShare: row.r_share ?? 1,
          poolUsdInGrid: row.t_r ?? 0,
          feeRateEma: 0,
          liveDailyPct: 0,
          feeShareEff: 0,
          lastBinsAt: 0,
          solUsd: row.capital,
          tokenUsd: 0,
          positionValue: row.capital,
          equity: row.capital,
        });
        void this.ensureWatch(row.pool);
      } catch {
        /* пропускаем битую строку */
      }
    }
    if (this.positions.length) journal("BOOT", `восстановлено позиций: ${this.positions.length}`);
  }

  private reconcile() {
    const open = db
      .prepare(`SELECT id, capital FROM positions WHERE mode = ? AND status = 'open' ORDER BY id DESC`)
      .all(this.mode) as any[];
    if (open.length > this.positions.length) {
      const keep = new Set(this.positions.map((p) => p.id));
      for (const row of open) {
        if (keep.has(row.id)) continue;
        db.prepare(
          `UPDATE positions SET status='closed', closed_at=?, exit_reason='DUPLICATE', pnl_usd=0, pnl_pct=0 WHERE id=?`,
        ).run(Date.now(), row.id);
        journal("WARN", `pos#${row.id} помечена дубликатом и закрыта`);
      }
    }
    const realized =
      (db.prepare(`SELECT COALESCE(SUM(pnl_usd),0) AS s FROM positions WHERE mode = ? AND status='closed'`).get(this.mode) as any)
        ?.s ?? 0;
    // из кэша ушёл исходный капитал позиции, а не текущий (текущий уменьшается после ребалансов)
    const live = this.positions.reduce((s, p) => s + (p.initialCapital || p.capital), 0);
    this.cash = Math.max(0, this.deposit + Number(realized) - live);
  }

  // ─────────────────────────── market data

  async getPools(force = false): Promise<Pool[]> {
    if (!force && Date.now() - this.poolListCache.at < 5 * 60_000 && this.poolListCache.pools.length) {
      return this.poolListCache.pools;
    }
    const [byTvl, byVol] = await Promise.allSettled([
      fetchPools(1000, "tvl:desc"),
      fetchPools(1000, "volume_24h:desc"),
    ]);
    const merged = new Map<string, Pool>();
    if (byTvl.status === "fulfilled") for (const p of byTvl.value) merged.set(p.address, p);
    if (byVol.status === "fulfilled") for (const p of byVol.value) if (!merged.has(p.address)) merged.set(p.address, p);
    const pools = [...merged.values()];
    this.poolListCache = { at: Date.now(), pools };
    return pools;
  }

  async getCandles(address: string, tf = "5m", force = false): Promise<Candle[]> {
    const conf = TF_MAP[tf] ?? TF_MAP["5m"];
    const key = `${address}:${tf}`;
    const ttl =
      tf === "1m" ? 20_000 : tf === "5m" ? 60_000 : tf === "30m" ? 180_000 : tf === "1h" ? 300_000 : 600_000;
    const hit = this.candlesCache.get(key);
    if (!force && hit && Date.now() - hit.at < ttl) return hit.candles;
    const flying = this.candleFlight.get(key);
    if (flying && !force) return flying;

    const promise = (async () => {
      try {
        const g = await fetchCandles(address, {
          timeframe: conf.gecko.timeframe,
          aggregate: conf.gecko.aggregate,
          limit: conf.gecko.limit,
        });
        if (g.length >= 10) return g;
      } catch {
        /* ниже Meteora */
      }
      if (conf.meteora) {
        const m = await fetchMeteoraCandles(address, conf.meteora.timeframe, conf.meteora.hours);
        if (m.length) return m;
      }
      throw new Error("нет данных по свечам");
    })()
      .then((candles) => {
        this.candlesCache.set(key, { at: Date.now(), candles });
        this.candleFlight.delete(key);
        return candles;
      })
      .catch((err) => {
        this.candleFlight.delete(key);
        if (hit) return hit.candles;
        throw err;
      });
    this.candleFlight.set(key, promise);
    return promise;
  }

  private alignCandles(candles: Candle[], ref?: number): Candle[] {
    if (!candles.length || !ref || !Number.isFinite(ref) || ref <= 0) return candles;
    const last = candles[candles.length - 1].c;
    if (!Number.isFinite(last) || last <= 0) return candles;
    const direct = Math.abs(Math.log(last / ref));
    const inverse = Math.abs(Math.log(1 / last / ref));
    if (inverse + 0.01 < direct) {
      return candles.map((c) => ({ t: c.t, o: 1 / c.o, h: 1 / c.l, l: 1 / c.h, c: 1 / c.c, v: c.v }));
    }
    return candles;
  }

  async ensureWatch(address: string) {
    try {
      const pool = await fetchPool(address);
      if (!pool) return;
      const pair = splitPair(pool);
      const creator = await resolveCreator(pair.token.address).catch(() => null);
      swapWatcher.watch({
        pool: pool.address,
        mint: pair.token.address,
        quoteMint: pair.sol.address,
        mintDecimals: pair.token.decimals || 9,
        quoteDecimals: pair.sol.decimals || 9,
        tokenIsX: pair.solIsY,
        quoteUsd: pair.solPrice > 0 ? pair.solPrice : 1,
        createdAt: pool.createdAt,
        creator,
      });
    } catch {
      /* не критично */
    }
  }

  // ─────────────────────────── scanning

  /** Дневной стоп: если за сутки потеряли больше лимита — не входим до следующих суток. */
  private checkDailyStop() {
    const day = new Date().toDateString();
    if (this.haltDay !== day) {
      this.haltDay = day;
      if (this.halted && this.haltReason === "дневной лимит убытка") {
        this.halted = false;
        this.haltReason = null;
        journal("BOOT", "новые сутки — дневной стоп снят");
      }
    }
    if (this.halted) return;
    const limit = (this.settings.maxDailyLossPct / 100) * this.deposit;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const realized =
      (db
        .prepare(`SELECT COALESCE(SUM(pnl_usd),0) AS s FROM positions WHERE mode=? AND status='closed' AND closed_at>=?`)
        .get(this.mode, startOfDay.getTime()) as any)?.s ?? 0;
    const open = this.positions.reduce((s, p) => {
      const rel = p.lastPrice / p.entryPrice;
      return s + positionValue(p.bins, rel).value + p.feesAccrued - p.initialCapital;
    }, 0);
    const pnl = Number(realized) + open;
    if (pnl <= -limit) {
      this.halted = true;
      this.haltReason = "дневной лимит убытка";
      this.persist();
      journal("HALT", `дневной убыток $${pnl.toFixed(2)} ≤ лимита −$${limit.toFixed(2)} → новые входы остановлены до завтра`);
    }
  }

  async scan(): Promise<void> {
    if (this.scanning) return;
    this.checkDailyStop();
    if (this.halted) return;
    this.scanning = true;
    const started = Date.now();
    try {
      const pools = await this.getPools();
      const st = this.settings;
      const now = Date.now();
      const funnel = { sol: 0, black: 0, tvl: 0, freeze: 0, holders: 0, turnover: 0, age: 0, atr: 0, flow: 0, blocked: 0 };

      const passed = pools.filter((p) => {
        if (!isSolPair(p)) return (funnel.sol++, false);
        if (p.isBlacklisted) return (funnel.black++, false);
        if (p.tvl < st.minPoolTvl) return (funnel.tvl++, false);
        if (!p.tokenX.freezeDisabled && p.tokenX.address !== env.wsolMint) return (funnel.freeze++, false);
        if (!p.tokenY.freezeDisabled && p.tokenY.address !== env.wsolMint) return (funnel.freeze++, false);
        if (now - p.createdAt < st.minAgeHours * 3600_000) return (funnel.age++, false);
        // органический спрос: у токена должно быть достаточно держателей (защита от накрутки)
        const pairInfo = splitPair(p);
        if (st.minHolders > 0 && pairInfo.token.holders < st.minHolders) return (funnel.holders++, false);
        const turnover = p.tvl > 0 ? p.vol24 / p.tvl : 0;
        if (turnover < st.minTurnover) return (funnel.turnover++, false);
        if (turnover > 60) return (funnel.turnover++, false);
        if (p.vol1h < st.minVol1h) return (funnel.flow++, false);
        const blockedUntil = this.blockedPools.get(p.address) ?? 0;
        if (blockedUntil > now) return (funnel.blocked++, false);
        return true;
      });

      // предварительный ранк: оборот × ставка (ATR проверим на глубоком анализе)
      const ranked = passed
        .map((p) => {
          const fee = ((p.baseFeePct + p.dynamicFeePct) * (1 - p.protocolFeePct / 100)) / 100;
          const turnover = p.tvl > 0 ? p.vol24 / p.tvl : 0;
          return { p, s: fee * turnover * 100 };
        })
        .sort((a, b) => b.s - a.s)
        .slice(0, 12);

      const analysed: StrategyPlan[] = [];
      for (const { p } of ranked) {
        try {
          const cached = this.analysisCache.get(p.address);
          const fresh =
            cached &&
            cached.deposit === this.deposit &&
            Date.now() - cached.at < 10 * 60_000 &&
            Math.abs(p.currentPrice / Math.max(1e-12, cached.price) - 1) < 0.01 &&
            Math.abs(p.vol24 / Math.max(1, cached.vol24) - 1) < 0.25;
          if (fresh) {
            analysed.push(cached!.plan);
            continue;
          }

          // ATR кэшируем на 10 минут: отказ по волатильности не требует повторного запроса свечей
          const seen = this.atrSeen.get(p.address);
          if (seen && Date.now() - seen.at < 10 * 60_000 && seen.atr > st.maxAtrPct) {
            continue; // уже записано в журнал при первом расчёте — не спамим
          }
          const candles30 = this.alignCandles(await this.getCandles(p.address, "30m"), p.currentPrice);
          if (candles30.length < 16) continue;
          const atr = computeAtr(candles30, 14);
          this.atrSeen.set(p.address, { at: Date.now(), atr });
          if (!atr || atr > st.maxAtrPct) {
            journal("REJECT", `${p.name} ATR ${atr.toFixed(2)}% > ${st.maxAtrPct}% — слишком волатильно`);
            continue;
          }
          const stats = priceStats(candles30);
          if (stats.rug) {
            journal("REJECT", `${p.name} падение ${stats.change24h.toFixed(1)}% (rug-фильтр)`);
            continue;
          }

          const binData = await readBinLiquidity(p, 0.08);
          const plan = buildBalancedPlan({
            pool: p,
            candles30m: candles30,
            binData,
            deposit: this.deposit,
            settings: st,
          });
          if (!plan) {
            journal("REJECT", `${p.name} не проходит фильтры стратегии (ATR ${atr.toFixed(2)}%, оборот ${(p.vol24 / Math.max(1, p.tvl)).toFixed(2)}x)`);
            continue;
          }
          analysed.push(plan);
          this.analysisCache.set(p.address, { at: Date.now(), price: p.currentPrice, vol24: p.vol24, deposit: this.deposit, plan });
          this.storeCandidate(plan);
          await new Promise((r) => setTimeout(r, 250));
        } catch (err: any) {
          this.log("WARN", `анализ ${p.name}: ${err?.message ?? err}`);
        }
      }

      analysed.sort((a, b) => b.expectedDailyPct - a.expectedDailyPct);
      this.candidates = analysed.map((a) => this.planToDto(a));
      this.lastScanAt = Date.now();

      journal(
        "SCAN",
        `пулов ${pools.length} → отсев [не SOL ${funnel.sol}, black ${funnel.black}, TVL ${funnel.tvl}, freeze ${funnel.freeze}, холдеры ${funnel.holders}, оборот ${funnel.turnover}, возраст ${funnel.age}, блок ${funnel.blocked}] → прошли ${passed.length} → разобрано ${analysed.length} → лучший ${
          analysed[0] ? `${analysed[0].pool.name} ${analysed[0].expectedDailyPct.toFixed(2)}%/сут (ATR ${analysed[0].atrPct.toFixed(2)}%)` : "—"
        } (${Date.now() - started} мс)`,
      );

      if (!this.running || this.halted) return;
      if (Date.now() < this.cooldownUntil) return;

      const slots = Math.max(0, this.slots - this.positions.length);
      if (slots <= 0) {
        await this.maybeRotate(analysed);
        if (analysed[0] && Date.now() - this.lastSkipAt > 10 * 60_000) {
          this.lastSkipAt = Date.now();
          journal("SKIP", `все слоты заняты (${this.positions.length}/${this.slots}) — ждём закрытия позиции`);
        }
        return;
      }
      const usedPools = new Set(this.positions.map((p) => p.pool.address));
      for (const plan of analysed) {
        if (this.positions.length >= this.slots) break;
        if (usedPools.has(plan.pool.address)) continue;
        if (this.cash < 10) break;
        await this.openPosition(plan);
      }
    } catch (err: any) {
      this.log("ERROR", `скан: ${err?.message ?? err}`);
      journal("ERROR", `скан упал: ${err?.message ?? err}`);
    } finally {
      this.scanning = false;
    }
  }

  private storeCandidate(plan: StrategyPlan) {
    const prev = this.scoreSeen.get(plan.pool.address);
    const changed =
      !prev ||
      Math.abs(plan.expectedDailyPct - prev.score) / Math.max(0.01, Math.abs(prev.score)) > 0.15 ||
      Date.now() - prev.at > 15 * 60_000;
    this.scoreSeen.set(plan.pool.address, { score: plan.expectedDailyPct, at: Date.now() });
    if (changed) {
      journal(
        "SCORE",
        `${plan.pool.name} ${plan.expectedDailyPct.toFixed(2)}%/сут ATR ${plan.atrPct.toFixed(2)}% оборот ${plan.turnover24.toFixed(1)}x диапазон ±${(plan.rangePct * 100).toFixed(1)}% T_r=$${Math.round(plan.rangeLiquidity).toLocaleString()} C=$${plan.capital.toFixed(0)} f=${(plan.feeRate * 100).toFixed(2)}%`,
      );
    }
    db.prepare(
      `INSERT INTO candidates (ts, pool, pool_name, score, r15, rday, t_r, capital, vol24, fee_pct, accepted, reason, payload)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      Date.now(),
      plan.pool.address,
      plan.pool.name,
      plan.expected15hPct,
      plan.expected15hPct,
      plan.expectedDailyPct,
      plan.rangeLiquidity,
      plan.capital,
      plan.pool.vol24,
      plan.feeRate * 100,
      plan.expectedDailyPct >= this.settings.targetDailyPct ? 1 : 0,
      plan.notes.join("; ") || "ok",
      JSON.stringify({
        atr: plan.atrPct,
        turnover: plan.turnover24,
        rangePct: plan.rangePct,
        concentration: plan.concentration,
        activeTvl: plan.activeTvl,
        inRangeShare: plan.inRangeShare,
      }),
    );
  }

  planToDto(p: StrategyPlan) {
    const pair = splitPair(p.pool);
    return {
      pool: p.pool.address,
      poolName: p.pool.name,
      tokenSymbol: pair.token.symbol,
      tokenMint: pair.token.address,
      score: +p.expected15hPct.toFixed(2),
      rDay: +p.expectedDailyPct.toFixed(2),
      r15h: +p.expected15hPct.toFixed(2),
      atrPct: +p.atrPct.toFixed(2),
      turnover24: +p.turnover24.toFixed(1),
      turnover1h: +p.turnover1h.toFixed(2),
      rangePct: +(p.rangePct * 100).toFixed(1),
      concentration: Math.round(p.concentration),
      tR: Math.round(p.rangeLiquidity),
      activeTvl: Math.round(p.activeTvl),
      capital: Math.round(p.capital),
      feePct: +(p.feeRate * 100).toFixed(3),
      vol24: Math.round(p.pool.vol24),
      vol1h: Math.round(p.pool.vol1h ?? 0),
      tvl: Math.round(p.pool.tvl),
      inRangeShare: +p.inRangeShare.toFixed(2),
      holders: pair.token.holders,
      poolFees24: Math.round(p.pool.fees24 ?? 0),
      poolFees1h: Math.round(p.pool.fees1h ?? 0),
      ourSharePct: +((p.capital / (p.rangeLiquidity + p.capital + 1e-9)) * 100).toFixed(2),
      ourHourly: +((p.expectedDailyPct / 100) * p.capital / 24).toFixed(3),
      distribution: p.distribution,
      avgEntryRel: +p.avgEntryPriceRel.toFixed(5),
      worstLossPct: +((p.rangePct + this.settings.frictionPct / 100) * 100).toFixed(2),
      expectedFees15h: +((p.capital * p.expectedDailyPct) / 100 * (15 / 24)).toFixed(2),
      source: "chain",
      notes: p.notes,
    };
  }

  /**
   * Ротация: слот занят, но на рынке есть пул, который кратно выгоднее.
   * Нужны два подтверждения подряд и возраст позиции > 30 минут, чтобы не дёргаться на шуме.
   */
  private async maybeRotate(analysed: StrategyPlan[]) {
    const best = analysed[0];
    if (!best) return;
    const worst = [...this.positions].sort(
      (a, b) => this.positionRate(a) - this.positionRate(b),
    )[0];
    if (!worst) return;
    if (worst.pool.address === best.pool.address) return;
    if (Date.now() - worst.openedAt < 30 * 60_000) return;

    const currentRate = this.positionRate(worst);
    const gain = best.expectedDailyPct / Math.max(0.05, currentRate);
    const minGain = 1.8;
    if (gain < minGain) {
      this.rotCandidate = null;
      this.rotChecks = 0;
      return;
    }
    if (this.rotCandidate === best.pool.address) this.rotChecks += 1;
    else {
      this.rotCandidate = best.pool.address;
      this.rotChecks = 1;
    }
    if (this.rotChecks < 2) return;

    this.rotChecks = 0;
    this.rotCandidate = null;
    journal(
      "EXIT_ROTATE",
      `pos#${worst.id} ${worst.pool.name} даёт ${currentRate.toFixed(2)}%/сут, а ${best.pool.name} — ${best.expectedDailyPct.toFixed(2)}%/сут (×${gain.toFixed(1)}) → ротация`,
    );
    await this.closePositionById(worst.id, "EXIT_ROTATE");
  }

  /** Текущая доходность позиции: живой темп, иначе прогноз на входе. */
  private positionRate(p: RtPos): number {
    if (p.liveDailyPct > 0) return p.liveDailyPct;
    return p.predictedDailyPct * 0.5;
  }

  // ─────────────────────────── open / rebalance / close

  async openPosition(plan: StrategyPlan) {
    if (this.positions.length >= this.slots) {
      journal("SKIP", `слотов нет (${this.positions.length}/${this.slots}) — ${plan.pool.name} пропущен`);
      return;
    }
    if (this.halted || !this.running) return;

    const pair = splitPair(plan.pool);
    const entryPrice = plan.pool.currentPrice;
    // при нескольких слотах делим капитал поровну, а не 50% депозита на каждый
    const perSlot = this.deposit / Math.max(1, this.slots);
    const capital = Math.min(plan.capital, this.cash, perSlot);
    if (capital < 10) return;

    const info = db
      .prepare(
        `INSERT INTO positions (mode, pool, pool_name, token_symbol, token_mint, status, capital, entry_price, p_avg, p_avg_price, p_exit, zones, bins, opened_at, updated_at, predicted_15h, t_r, r_share, fee_pct, vol24, last_price, last_claim_at, range_pct, atr_pct, turnover24, entry_kind, rebalances, consecutive_losses)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        this.mode,
        plan.pool.address,
        plan.pool.name,
        pair.token.symbol,
        pair.token.address,
        "open",
        capital,
        entryPrice,
        entryPrice,
        entryPrice,
        entryPrice * (1 - plan.rangePct),
        JSON.stringify({ z1: { lowRel: -plan.rangePct, highRel: plan.rangePct }, z2: { lowRel: -plan.rangePct, highRel: plan.rangePct } }),
        JSON.stringify(plan.bins.map((b) => ({ ...b, usd: b.usd * (capital / plan.capital) }))),
        Date.now(),
        Date.now(),
        plan.expected15hPct,
        plan.rangeLiquidity,
        plan.inRangeShare,
        plan.feeRate,
        plan.pool.vol24,
        entryPrice,
        Date.now(),
        plan.rangePct,
        plan.atrPct,
        plan.turnover24,
        "balanced",
        0,
        0,
      );
    const id = Number(info.lastInsertRowid);
    db.prepare(`UPDATE positions SET initial_capital = ?, friction_usd = 0 WHERE id = ?`).run(capital, id);

    const bins: RtBin[] = plan.bins.map((b) => ({
      k: b.k,
      priceRel: b.priceRel,
      usd: b.usd * (capital / plan.capital),
      poolUsd: b.poolUsd ?? 0,
      feePerDay: b.feePerDay * (capital / plan.capital),
    }));

    this.cash -= capital;
    const pos: RtPos = {
      id,
      pool: plan.pool,
      tokenSymbol: pair.token.symbol,
      tokenMint: pair.token.address,
      tokenDecimals: pair.token.decimals || 9,
      tokenPriceUsd: pair.token.price > 0 ? pair.token.price : 0,
      solPriceUsd: pair.solPrice > 0 ? pair.solPrice : 200,
      tokenIsX: pair.solIsY,
      capital,
      initialCapital: capital,
      frictionPaid: 0,
      vol30m: 0,
      entryPrice,
      avgEntryRel: 1,
      rangePct: plan.rangePct,
      bins,
      filled: new Set<number>(bins.filter((b) => b.priceRel <= 1).map((b) => b.k)),
      feesAccrued: 0,
      feesClaimed: 0,
      claimedAt: Date.now(),
      openedAt: Date.now(),
      lastPrice: entryPrice,
      lastTick: Date.now(),
      lastAllocAt: 0,
      rebalances: 0,
      consecutiveLosses: 0,
      lastRebalanceAt: 0,
      breakChecks: 0,
      lowConditionChecks: 0,
      ticks: 0,
      priceHist: [entryPrice],
      lastApiPrice: 0,
      lastApiAt: 0,
      atrPct: plan.atrPct,
      turnover24: plan.turnover24,
      predictedDailyPct: plan.expectedDailyPct,
      inRangeShare: plan.inRangeShare,
      poolUsdInGrid: bins.reduce((s, b) => s + (b.poolUsd ?? 0), 0) || plan.rangeLiquidity,
      feeRateEma: 0,
      liveDailyPct: 0,
      feeShareEff: 0,
      lastBinsAt: 0,
      solUsd: capital,
      tokenUsd: 0,
      positionValue: capital,
      equity: this.deposit,
    };
    this.positions.push(pos);
    this.persist();

    journal(
      "ENTER",
      `pos#${id} ${plan.pool.name} C=$${capital.toFixed(0)} 50/50 диапазон ±${(plan.rangePct * 100).toFixed(1)}% (концентрация ×${Math.round(plan.concentration)}) прогноз ${plan.expectedDailyPct.toFixed(2)}%/сут ATR ${plan.atrPct.toFixed(2)}%`,
    );
    event(id, "ENTER", { capital, rangePct: plan.rangePct, atr: plan.atrPct, bins: bins.length });

    void (async () => {
      const creator = await resolveCreator(pair.token.address).catch(() => null);
      swapWatcher.watch({
        pool: plan.pool.address,
        mint: pair.token.address,
        quoteMint: pair.sol.address,
        mintDecimals: pair.token.decimals || 9,
        quoteDecimals: pair.sol.decimals || 9,
        tokenIsX: pair.solIsY,
        quoteUsd: pair.solPrice > 0 ? pair.solPrice : 1,
        createdAt: plan.pool.createdAt,
        creator,
      });
    })();
  }

  /** Ребаланс: фиксируем стоимость, платим friction, строим новую сетку от текущей цены. */
  private async rebalance(pos: RtPos, price: number) {
    const rel = price / pos.entryPrice;
    const { value } = positionValue(pos.bins, rel);
    const frictionUsd = value * (this.settings.frictionPct / 100);
    const newCapital = Math.max(0, value - frictionUsd);
    // «убыточный» ребаланс — когда потеряли больше, чем стоят издержки свопа
    const lost = newCapital < pos.capital * 0.9985;

    const oldCapital = pos.capital;
    pos.capital = newCapital;
    pos.entryPrice = price;
    pos.bins = pos.bins.map((b) => ({ ...b, usd: (b.usd / Math.max(1e-9, oldCapital)) * newCapital }));
    {
      let tu = 0;
      let ta = 0;
      for (const b of pos.bins) if (b.priceRel > 1) { tu += b.usd; ta += b.usd / b.priceRel; }
      pos.avgEntryRel = ta > 0 ? tu / ta : 1;
    }
    pos.filled = new Set<number>();
    pos.breakChecks = 0;
    pos.rebalances += 1;
    pos.frictionPaid += frictionUsd;
    pos.lastRebalanceAt = Date.now();
    pos.consecutiveLosses = lost ? pos.consecutiveLosses + 1 : 0;

    db.prepare(
      `UPDATE positions SET capital=?, entry_price=?, p_avg_price=?, p_exit=?, bins=?, rebalances=?, consecutive_losses=?, friction_usd=?, updated_at=? WHERE id=?`,
    ).run(
      pos.capital,
      pos.entryPrice,
      pos.entryPrice,
      pos.entryPrice * (1 - pos.rangePct),
      JSON.stringify(pos.bins),
      pos.rebalances,
      pos.consecutiveLosses,
      pos.frictionPaid,
      Date.now(),
      pos.id,
    );
    event(pos.id, "REBALANCE", { from: oldCapital, to: pos.capital, frictionUsd, price, rel });
    journal(
      "REBALANCE",
      `pos#${pos.id} ребаланс #${pos.rebalances}: цена ${((rel - 1) * 100).toFixed(2)}% → новая сетка ±${(pos.rangePct * 100).toFixed(1)}% от ${price.toFixed(8)}, капитал $${oldCapital.toFixed(0)}→$${pos.capital.toFixed(0)} (friction $${frictionUsd.toFixed(2)}), серия убытков ${pos.consecutiveLosses}`,
    );

    if (pos.consecutiveLosses >= this.settings.consecutiveLossStop) {
      journal("STOP", `pos#${pos.id} ${pos.consecutiveLosses} убыточных ребаланса подряд → полный выход и смена пула`);
      this.blockedPools.set(pos.pool.address, Date.now() + 30 * 60_000);
      await this.closePositionById(pos.id, "CONSECUTIVE_LOSS", price);
      return;
    }
    if (pos.rebalances >= this.settings.maxRebalancesPerDay) {
      journal("STOP", `pos#${pos.id} лимит ребалансов ${this.settings.maxRebalancesPerDay}/сут → выход`);
      this.blockedPools.set(pos.pool.address, Date.now() + 60 * 60_000);
      await this.closePositionById(pos.id, "MAX_REBALANCES", price);
    }
  }

  /** Ручной вход в конкретный пул из скринера. */
  async enterByAddress(address: string) {
    if (this.positions.some((p) => p.pool.address === address)) {
      journal("SKIP", `пул ${address.slice(0, 6)}… уже в работе`);
      return { ok: false, reason: "already-open" };
    }
    if (this.positions.length >= this.slots) return { ok: false, reason: "no-slots" };
    const pool = await fetchPool(address);
    if (!pool) return { ok: false, reason: "pool-not-found" };
    const st = this.settings;
    const candles30 = this.alignCandles(await this.getCandles(pool.address, "30m"), pool.currentPrice);
    if (candles30.length < 16) return { ok: false, reason: "no-candles" };
    const binData = await readBinLiquidity(pool, 0.08);
    const plan = buildBalancedPlan({ pool, candles30m: candles30, binData, deposit: this.deposit, settings: st });
    if (!plan) return { ok: false, reason: "filters" };
    if (this.cash < 10) return { ok: false, reason: "no-cash" };
    await this.openPosition(plan);
    return { ok: true, plan: this.planToDto(plan) };
  }

  // ─────────────────────────── monitoring

  async tick(quick = false) {
    if (!this.positions.length) return;
    if (quick && Date.now() - this.lastQuickTick < 700) return;
    if (quick) this.lastQuickTick = Date.now();

    for (const pos of [...this.positions]) {
      try {
        await this.tickPosition(pos);
      } catch (err: any) {
        journal("ERROR", `tick pos#${pos.id}: ${err?.message ?? err}`);
      }
    }
  }

  private lastQuickTick = 0;

  private async tickPosition(pos: RtPos) {
    const now = Date.now();
    const dtSec = Math.max(0, (now - pos.lastTick) / 1000);
    pos.lastTick = now;
    pos.ticks += 1;

    // ── цена: база — активный бин пула (API), поток свапов — только как уточнение
    let apiPrice: number | null = null;
    const needApi = now - pos.lastApiAt > 20_000;
    if (needApi || !pos.lastApiPrice) {
      try {
        const fresh = await fetchPool(pos.pool.address);
        if (fresh && fresh.currentPrice > 0) {
          apiPrice = fresh.currentPrice;
          pos.lastApiPrice = apiPrice;
          pos.lastApiAt = now;
          if (fresh.tvl > 0) pos.pool.tvl = fresh.tvl;
          if (fresh.vol24 > 0) pos.pool.vol24 = fresh.vol24;
          if (fresh.vol1h >= 0) pos.pool.vol1h = fresh.vol1h;
          if (fresh.binStep > 0) pos.pool.binStep = fresh.binStep;
          if (fresh.fees24 >= 0) pos.pool.fees24 = fresh.fees24;
          if (fresh.fees30m >= 0) pos.pool.fees30m = fresh.fees30m;
          if (fresh.fees1h >= 0) pos.pool.fees1h = fresh.fees1h;
          pos.turnover24 = fresh.tvl > 0 ? fresh.vol24 / fresh.tvl : pos.turnover24;
        }
      } catch {
        /* остаёмся на прошлой цене */
      }
    }

    // поток свапов: цена одной сделки может быть выбросом (мульти-хоп, тонкий бин),
    // поэтому берём её только если она согласуется с ценой активного бина в пределах 1%
    const ref = pos.lastApiPrice || pos.lastPrice;
    const streamedRaw = swapWatcher.priceFor(pos.pool.address, 20_000);
    const streamed = streamedRaw && streamedRaw > 0 ? (pos.tokenIsX ? streamedRaw : 1 / streamedRaw) : null;
    let price = apiPrice ?? ref;
    if (streamed && ref > 0 && Math.abs(Math.log(streamed / ref)) < 0.01) price = streamed;

    // медиана последних 5 отсчётов гасит одиночные выбросы и не даёт ложный ребаланс
    pos.priceHist.push(price);
    if (pos.priceHist.length > 5) pos.priceHist.shift();
    if (pos.priceHist.length >= 3) {
      const sorted = [...pos.priceHist].sort((a, b) => a - b);
      price = sorted[Math.floor(sorted.length / 2)];
    }
    pos.lastPrice = price;
    const rel = price / pos.entryPrice;

    // объём последней 30-минутной свечи — для карточки позиции
    try {
      const c30 = await this.getCandles(pos.pool.address, "30m");
      const lastC = c30[c30.length - 1];
      if (lastC && Number.isFinite(lastC.v)) pos.vol30m = lastC.v;
    } catch {
      /* без свечей — оставляем прошлое значение */
    }

    // ── ликвидность пула по бинам (для честной доли комиссий) — раз в 10 минут
    if (now - pos.lastBinsAt > 10 * 60_000) {
      pos.lastBinsAt = now;
      try {
        if (!pos.pool.tokenX?.price || !pos.pool.tvl) {
          const full = await fetchPool(pos.pool.address);
          if (full) pos.pool = { ...full, currentPrice: full.currentPrice || pos.pool.currentPrice };
        }
        const span = Math.min(0.25, Math.max(0.05, pos.rangePct * 1.8));
        const bd = await readBinLiquidity(pos.pool, span);
        const abs = bd.bins.map((b) => ({ price: price * b.priceRel, usd: b.usd }));
        for (const b of pos.bins) {
          const target = pos.entryPrice * b.priceRel;
          let bestUsd = 0;
          let bestD = Infinity;
          for (const a of abs) {
            const d = Math.abs(Math.log(a.price / target));
            if (d < bestD) {
              bestD = d;
              bestUsd = a.usd;
            }
          }
          if (bestD < 0.02) b.poolUsd = Math.max(0, bestUsd);
        }
        const total = pos.bins.reduce((s, b) => s + (b.poolUsd ?? 0), 0);
        if (total > 0) pos.poolUsdInGrid = total;
      } catch {
        /* без обновления — остаёмся на прошлой оценке */
      }
    }

    // ── комиссии в реальном времени (см. accrueFees)
    pos.feesAccrued += this.accrueFees(pos, dtSec, rel);

    // ── средняя цена входа: себестоимость токенов, которые сейчас держим
    {
      let amt = 0;
      let cost = 0;
      for (const b of pos.bins) {
        if (b.priceRel > 1) {
          amt += b.usd; // куплены по цене входа
          cost += b.usd;
        } else if (rel < b.priceRel) {
          const tokens = b.usd / b.priceRel; // залиты по цене своего бина
          amt += tokens;
          cost += b.usd;
        }
      }
      pos.avgEntryRel = amt > 0 ? cost / amt : 1;
    }

    // ── стоимость и сплит
    const val = positionValue(pos.bins, rel);
    pos.positionValue = val.value;
    pos.solUsd = val.solUsd;
    pos.tokenUsd = val.tokenUsd;
    pos.equity = this.cash + this.totalLiveValue() + pos.feesAccrued;

    // ── заполнение бинов (для карточки)
    const filledNow = new Set<number>();
    for (const b of pos.bins) if (b.priceRel <= rel) filledNow.add(b.k);
    const newFills = [...filledNow].filter((k) => !pos.filled.has(k));
    if (newFills.length && pos.ticks > 1) {
      event(pos.id, "FILL", { bins: newFills, price });
      journal("FILL", `pos#${pos.id} цена ${((rel - 1) * 100).toFixed(2)}% → заполнено бинов ${newFills.length}`);
    }
    pos.filled = filledNow;

    if (now - pos.lastAllocAt > 25_000) {
      pos.lastAllocAt = now;
      db.prepare(`INSERT INTO pos_alloc (position_id, ts, sol_usd, token_usd, price) VALUES (?,?,?,?,?)`).run(
        pos.id,
        now,
        val.solUsd,
        val.tokenUsd,
        price,
      );
    }

    // ── клейм
    const claimByTime = now - pos.claimedAt > this.settings.claimIntervalHours * 3600_000;
    const claimBySize = pos.feesAccrued >= pos.capital * (env.strategy.claimThresholdPct / 100);
    if ((claimByTime || claimBySize) && pos.feesAccrued > 0.01) {
      const claimed = pos.feesAccrued;
      pos.feesClaimed += claimed;
      pos.feesAccrued = 0;
      this.cash += claimed;
      pos.claimedAt = now;
      db.prepare(`UPDATE positions SET fees_usd=?, claimed_usd=?, last_claim_at=? WHERE id=?`).run(0, pos.feesClaimed, now, pos.id);
      event(pos.id, "CLAIM", { claimed });
      journal("CLAIM", `pos#${pos.id} комиссии $${claimed.toFixed(2)} → SOL`);
    }

    // ── лимит времени в сделке
    if (this.settings.maxHoldHours > 0 && now - pos.openedAt > this.settings.maxHoldHours * 3600_000) {
      journal("EXIT_TIME", `pos#${pos.id} отработала ${this.settings.maxHoldHours}ч → ротация в другой пул`);
      await this.closePositionById(pos.id, "EXIT_TIME", price);
      return;
    }

    // ── выход за границу сетки → ребаланс
    if (now - pos.openedAt < 60_000) return;
    const out = rel > 1 + pos.rangePct || rel < 1 - pos.rangePct;
    pos.breakChecks = out ? pos.breakChecks + 1 : 0;
    if (pos.breakChecks >= 2) {
      await this.rebalance(pos, price);
      return;
    }

    // ── проверка условий рынка раз в 5 минут
    if (now - (pos as any).lastConditionAt > 5 * 60_000) {
      (pos as any).lastConditionAt = now;
      try {
        const candles30 = this.alignCandles(await this.getCandles(pos.pool.address, "30m"), price);
        const atr = computeAtr(candles30, 14);
        pos.atrPct = atr;
        pos.inRangeShare = volumeShareInRange(candles30, price, pos.rangePct) || pos.inRangeShare;
        const tooVolatile = atr > this.settings.earlyExitAtrPct;
        const feeDrop = pos.liveDailyPct > 0 && pos.liveDailyPct < Math.max(0.4, pos.predictedDailyPct * 0.35);
        const tooQuiet = (pos.turnover24 > 0 && pos.turnover24 < this.settings.earlyExitTurnover) || feeDrop;
        if (tooVolatile || tooQuiet) {
          pos.lowConditionChecks += 1;
        } else {
          pos.lowConditionChecks = 0;
        }
        if (pos.lowConditionChecks >= 2) {
          journal(
            "STOP",
            `pos#${pos.id} условия ухудшились (ATR ${atr.toFixed(2)}%, оборот ${pos.turnover24.toFixed(2)}x) → выход`,
          );
          await this.closePositionById(pos.id, tooVolatile ? "EXIT_VOLATILITY" : "EXIT_FLOW", price);
          return;
        }
      } catch {
        /* пропускаем проверку */
      }
    }

    // ── сводка раз в 30 минут
    if (now - this.lastSummaryAt > 30 * 60_000) {
      this.lastSummaryAt = now;
      const hours = (now - pos.openedAt) / 3600_000;
      const actualDaily = hours > 0.2 ? ((pos.feesAccrued + pos.feesClaimed) / pos.capital / hours) * 24 * 100 : 0;
      journal(
        "SUMMARY",
        `pos#${pos.id} ${pos.tokenSymbol}: ${hours.toFixed(1)}ч · 50/50=${(val.solUsd / (val.value || 1) * 100).toFixed(0)}/${(val.tokenUsd / (val.value || 1) * 100).toFixed(0)} · комиссии $${(pos.feesAccrued + pos.feesClaimed).toFixed(2)} (факт ${actualDaily.toFixed(2)}%/сут, сейчас ${pos.liveDailyPct.toFixed(2)}%/сут, прогноз ${pos.predictedDailyPct.toFixed(2)}%/сут) · ребалансов ${pos.rebalances} · цена ${((rel - 1) * 100).toFixed(2)}% от центра`,
      );
    }

    db.prepare(`UPDATE positions SET last_price=?, fees_usd=?, il_usd=?, updated_at=?, atr_pct=?, turnover24=? WHERE id=?`).run(
      price,
      pos.feesAccrued,
      val.value - pos.capital,
      now,
      pos.atrPct,
      pos.turnover24,
      pos.id,
    );

    // ── снапшот капитала
    if (now - this.lastSnapshotAt > 59_000) {
      this.lastSnapshotAt = now;
      this.snapshotEquityNow();
    }

    // ── фиксация прибыли «на холодный кошелёк»
    const equity = this.equityNow();
    if (equity >= this.nextMilestone) {
      const profit = equity - this.deposit;
      const take = profit * (this.settings.profitTakePct / 100);
      if (take > 1) {
        this.banked += take;
        this.cash = Math.max(0, this.cash - take);
        this.nextMilestone = equity * 1.1;
        this.persist();
        journal("SUMMARY", `фиксация прибыли: $${take.toFixed(2)} отложено (всего $${this.banked.toFixed(2)}), следующая веха $${this.nextMilestone.toFixed(0)}`);
      }
    }
  }

  /**
   * Комиссии в реальном времени.
   * База — фактический run-rate пула (`fees.24h` из Meteora), с поправкой на последние 30 минут
   * (если пул разогрелся или остыл, темп меняется, но не больше ±50%). Начисляем только пока
   * цена внутри сетки: за её границей наша ликвидность не торгуется и комиссий не приносит.
   */
  private accrueFees(pos: RtPos, dtSec: number, rel: number): number {
    const f24 = pos.pool.fees24 ?? 0;
    const f30 = (pos.pool.fees30m ?? 0) * 48; // темп последних 30 минут в суточном эквиваленте
    const f1h = (pos.pool.fees1h ?? 0) * 24;
    // смесь горизонтов: свежие окна весят больше, суточное — как якорь
    const parts: [number, number][] = [
      [f30, 0.35],
      [f1h, 0.35],
      [f24, 0.3],
    ].filter(([v]) => (v as number) > 0) as [number, number][];
    let target = f24;
    if (parts.length) {
      const wsum = parts.reduce((a, [, w]) => a + w, 0);
      target = parts.reduce((a, [v, w]) => a + v * w, 0) / (wsum || 1);
    }
    if (f24 > 0) target = Math.min(Math.max(target, f24 * 0.25), f24 * 2);
    pos.feeRateEma = pos.feeRateEma > 0 ? pos.feeRateEma * 0.85 + target * 0.15 : target;

    const ourUsd = pos.bins.reduce((s, b) => s + b.usd, 0);
    const poolUsdLive = pos.bins.reduce((s, b) => s + (b.poolUsd ?? 0), 0);
    // если цепь не отдала бины, берём снимок ликвидности коридора (не даём доле стать 100%)
    const poolUsd = poolUsdLive > 0 ? poolUsdLive : pos.poolUsdInGrid || ourUsd * 19;
    // доля взвешивается по тому, где реально проходит объём: у активной цены (σ ≈ 2.5 бина),
    // иначе на пике колокола наша доля занижается
    const step = Math.max(0.0005, (pos.pool.binStep ?? 100) / 10_000);
    const lnStep = Math.log(1 + step);
    const lnRel = Math.log(Math.max(1e-9, rel));
    let vW = 0;
    let vShare = 0;
    for (const b of pos.bins) {
      const d = Math.abs(Math.log(Math.max(1e-9, b.priceRel)) - lnRel) / lnStep;
      const w = Math.exp(-0.5 * Math.pow(d / 1.0, 2)); // объём практически только в бине у цены
      const binPool = (b.poolUsd ?? 0) > 0 ? b.poolUsd : (poolUsd / Math.max(1, pos.bins.length));
      const sh = Math.min(0.5, b.usd / Math.max(1e-9, b.usd + binPool));
      vShare += w * sh;
      vW += w;
    }
    const share = vW > 0 ? Math.min(0.5, vShare / vW) : ourUsd / Math.max(1e-9, ourUsd + poolUsd);

    const inGrid = rel >= 1 - pos.rangePct && rel <= 1 + pos.rangePct;
    const perDay = inGrid ? pos.feeRateEma * (pos.inRangeShare || 1) * share * this.settings.utilization : 0;
    pos.feeShareEff = share;
    pos.liveDailyPct = pos.capital > 0 ? (perDay / pos.capital) * 100 : 0;
    return (perDay * dtSec) / 86400;
  }

  // ─────────────────────────── close

  async closePositionById(id: number, reason: string, priceOverride?: number) {
    const pos = this.positions.find((p) => p.id === id);
    if (!pos) return;
    const price = priceOverride ?? pos.lastPrice;
    const rel = price / pos.entryPrice;
    const { value: fairUsd, tokenUsd } = positionValue(pos.bins, rel);

    // продаём токеновую часть через Jupiter (реальная котировка), если она есть
    let proceeds = fairUsd;
    let slipPct = 0;
    let slipSource = "none";
    if (tokenUsd > 0.5) {
      if (!pos.tokenPriceUsd || pos.tokenPriceUsd <= 0) {
        try {
          const fresh = await fetchPool(pos.pool.address);
          if (fresh) {
            const pair = splitPair(fresh);
            pos.tokenPriceUsd = pair.token.price > 0 ? pair.token.price : 0;
            pos.solPriceUsd = pair.solPrice > 0 ? pair.solPrice : pos.solPriceUsd;
            pos.tokenDecimals = pair.token.decimals || pos.tokenDecimals;
          }
        } catch {
          /* останемся на оценке */
        }
      }
      const tokens = pos.tokenPriceUsd > 0 ? tokenUsd / pos.tokenPriceUsd : 0;
      const amountRaw = Math.round(tokens * 10 ** (pos.tokenDecimals || 9));
      const quote =
        amountRaw > 0 ? await jupiterQuote(pos.tokenMint, env.wsolMint, String(amountRaw), 300) : null;
      if (quote && quote.outAmount > 0) {
        const outUsd = (quote.outAmount / 1e9) * (pos.solPriceUsd || 200);
        const est = 1 - outUsd / Math.max(1e-9, tokenUsd);
        slipPct = Math.min(0.35, Math.max(0.0002, est)) + 0.0006;
        slipSource = "jupiter";
      } else {
        slipPct = this.settings.frictionPct / 100;
        slipSource = "estimate";
      }
      proceeds = fairUsd - tokenUsd * slipPct;
    }

    // снятые комиссии уже лежат в кассе, но результат сделки они тоже формируют;
    // просадка базы от ребалансов (initialCapital − capital) учтена через initialCapital
    const pnl = proceeds + pos.feesAccrued + pos.feesClaimed - pos.initialCapital;
    const pnlPct = (pnl / this.deposit) * 100;
    this.cash += proceeds + pos.feesAccrued;

    const hours = Math.max(0.01, (Date.now() - pos.openedAt) / 3600_000);
    const actualDaily = ((pos.feesAccrued + pos.feesClaimed) / pos.capital / hours) * 24 * 100;

    db.prepare(
      `UPDATE positions SET status='closed', closed_at=?, exit_price=?, fees_usd=?, il_usd=?, pnl_usd=?, pnl_pct=?, exit_reason=?, updated_at=?, actual_fee_pct_daily=?, exit_slip_pct=? WHERE id=?`,
    ).run(
      Date.now(),
      price,
      pos.feesAccrued + pos.feesClaimed,
      fairUsd - pos.capital,
      pnl,
      pnlPct,
      reason,
      Date.now(),
      actualDaily,
      slipPct * 100,
      pos.id,
    );
    event(pos.id, reason, { price, pnl, pnlPct, fees: pos.feesAccrued, slipPct, slipSource });
    journal(
      reason as JournalType,
      `pos#${pos.id} ${pos.pool.name} pnl=$${pnl.toFixed(2)} (${pnlPct.toFixed(2)}% депозита) fees=$${(pos.feesAccrued + pos.feesClaimed).toFixed(2)} ребалансов ${pos.rebalances} slip=${(slipPct * 100).toFixed(2)}% (${slipSource})`,
    );
    this.log(reason, `pos#${pos.id} закрыта: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);

    this.positions = this.positions.filter((p) => p.id !== pos.id);
    this.persist();
    this.cooldownUntil = Date.now() + 30_000;
    this.snapshotEquityNow();

    if (pnlPct <= -this.settings.maxLossPerTradePct) this.blockedPools.set(pos.pool.address, Date.now() + 60 * 60_000);

    // ищем замену сразу
    setTimeout(() => void this.scan(), 5000);
  }

  async closePosition(reason: string, price?: number) {
    const first = this.positions[0];
    if (!first) return;
    await this.closePositionById(first.id, reason, price);
  }

  // ─────────────────────────── helpers / dto

  totalLiveValue(): number {
    let sum = 0;
    for (const p of this.positions) {
      const rel = p.lastPrice / p.entryPrice;
      sum += positionValue(p.bins, rel).value;
    }
    return sum;
  }

  equityNow(): number {
    const fees = this.positions.reduce((s, p) => s + p.feesAccrued, 0);
    return this.cash + this.totalLiveValue() + fees;
  }

  getEquity() {
    const inPositions = this.totalLiveValue();
    const pendingFees = this.positions.reduce((s, p) => s + p.feesAccrued, 0);
    return { equity: this.cash + inPositions + pendingFees, cash: this.cash, inPositions, pendingFees };
  }

  totalFees(): number {
    const row = db.prepare(`SELECT COALESCE(SUM(fees_usd),0) AS f FROM positions WHERE mode = ?`).get(this.mode) as any;
    return Number(row?.f ?? 0);
  }

  /** PnL за период = изменение капитала с начала периода (а не сумма сделок). */
  pnlPeriod(period: "day" | "week" | "month" | "all" = "day") {
    const now = Date.now();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const from =
      period === "day"
        ? dayStart.getTime()
        : period === "week"
          ? now - 7 * 86_400_000
          : period === "month"
            ? now - 30 * 86_400_000
            : 0;

    const first = db
      .prepare(`SELECT equity FROM equity WHERE mode=? ORDER BY ts ASC LIMIT 1`)
      .get(this.mode) as any;
    const before = db
      .prepare(`SELECT equity FROM equity WHERE mode=? AND ts<=? ORDER BY ts DESC LIMIT 1`)
      .get(this.mode, from) as any;

    const equityNow = this.getEquity().equity;
    const equityStart = Number(before?.equity ?? first?.equity ?? this.deposit);

    const series = db
      .prepare(`SELECT ts, equity FROM equity WHERE mode=? AND ts>=? ORDER BY ts`)
      .all(this.mode, from) as any[];

    const closed = db
      .prepare(
        `SELECT COALESCE(SUM(pnl_usd),0) AS pnl, COUNT(*) AS n FROM positions WHERE mode=? AND status='closed' AND closed_at>=?`,
      )
      .get(this.mode, from) as any;

    const unrealized = this.positions.reduce((sum, p) => {
      const rel = p.lastPrice / p.entryPrice;
      const val = positionValue(p.bins, rel);
      return sum + (val.value + p.feesAccrued + p.feesClaimed - p.initialCapital);
    }, 0);
    const realized = Number(closed?.pnl ?? 0);

    const pnl = equityNow - equityStart;
    return {
      period,
      from,
      to: now,
      equityNow,
      equityStart,
      pnl,
      pnlPct: equityStart > 0 ? (pnl / equityStart) * 100 : 0,
      realized,
      unrealized,
      trades: Number(closed?.n ?? 0),
      series: series.map((r) => ({ ts: r.ts, equity: r.equity })),
    };
  }

  snapshotEquityNow() {
    const eq = this.getEquity();
    db.prepare(`INSERT INTO equity (ts, mode, equity, cash, in_positions, fees_cum) VALUES (?,?,?,?,?,?)`).run(
      Date.now(),
      this.mode,
      eq.equity,
      eq.cash,
      eq.inPositions,
      this.totalFees(),
    );
  }

  positionDto(p = this.positions[0]) {
    if (!p) return null;
    const rel = p.lastPrice / p.entryPrice;
    const val = positionValue(p.bins, rel);
    const total = val.value || 1;
    return {
      id: p.id,
      pool: p.pool.address,
      poolName: p.pool.name,
      tokenSymbol: p.tokenSymbol,
      tokenMint: p.tokenMint,
      capital: p.capital,
      entryPrice: p.entryPrice,
      lastPrice: p.lastPrice,
      pAvgPrice: p.entryPrice * (p.avgEntryRel || 1),
      avgEntryRel: p.avgEntryRel || 1,
      pExitPrice: p.entryPrice * (1 - p.rangePct),
      upperPrice: p.entryPrice * (1 + p.rangePct),
      rangePct: p.rangePct,
      atrPct: p.atrPct,
      turnover24: p.turnover24,
      rebalances: p.rebalances,
      maxRebalances: this.settings.maxRebalancesPerDay,
      consecutiveLosses: p.consecutiveLosses,
      consecutiveLossStop: this.settings.consecutiveLossStop,
      binsCount: p.bins.length,
      activeBins: p.filled.size,
      atrExitPct: this.settings.earlyExitAtrPct,
      turnoverExit: this.settings.earlyExitTurnover,
      predictedDailyPct: p.predictedDailyPct,
      liveDailyPct: p.liveDailyPct,
      inRangeShare: p.inRangeShare,
      feeRatePoolDay: p.feeRateEma,
      feeShare:
        p.feeShareEff ||
        p.bins.reduce((s, b) => s + b.usd, 0) /
          Math.max(
            1e-9,
            p.bins.reduce((s, b) => s + b.usd, 0) +
              (p.bins.reduce((s, b) => s + (b.poolUsd ?? 0), 0) || p.poolUsdInGrid || 0),
          ),
      poolUsdInGrid: p.poolUsdInGrid,
      frictionPct: this.settings.frictionPct,
      maxHoldHours: this.settings.maxHoldHours,
      zones: { z1: { lowRel: -p.rangePct, highRel: p.rangePct } },
      bins: p.bins,
      openedAt: p.openedAt,
      feesAccrued: p.feesAccrued,
      feesClaimed: p.feesClaimed,
      predicted15h: p.predictedDailyPct * (15 / 24),
      predictedFeePct15hCapital: p.predictedDailyPct * (15 / 24),
      tR: 0,
      rShare: 0,
      feePct: 0,
      vol24: p.pool.vol24,
      vol30m: p.vol30m ?? 0,
      poolTvl: p.pool.tvl,
      solUsd: val.solUsd,
      tokenUsd: val.tokenUsd,
      solPct: (val.solUsd / total) * 100,
      tokenPct: (val.tokenUsd / total) * 100,
      allocationPct: (val.tokenUsd / total) * 100,
      value: val.value,
      initialCapital: p.initialCapital,
      frictionPaid: p.frictionPaid,
      bodyPnl: val.value - p.capital,
      // Итого = всё, что позиция дала сверх вложенного: тело + комиссии (в кассе и начисленные)
      // реализовано = уже снятые комиссии минус просадка базы от ребалансов (friction)
      // не реализовано = текущая стоимость тела + начисленные комиссии минус текущая база
      realizedPnl: p.feesClaimed - (p.initialCapital - p.capital),
      unrealizedPnl: val.value + p.feesAccrued - p.capital,
      pnl: val.value + p.feesAccrued + p.feesClaimed - p.initialCapital,
      pnlPctOfDeposit: ((val.value + p.feesAccrued + p.feesClaimed - p.initialCapital) / this.deposit) * 100,
      pnlPctDeposit: ((val.value + p.feesAccrued + p.feesClaimed - p.initialCapital) / this.deposit) * 100,
      pnlPctOfCapital:
        p.initialCapital > 0
          ? ((val.value + p.feesAccrued + p.feesClaimed - p.initialCapital) / p.initialCapital) * 100
          : 0,
      timeInTradeHours: (Date.now() - p.openedAt) / 3600_000,
      inRange: rel <= 1 + p.rangePct && rel >= 1 - p.rangePct,
      distanceToUpperPct: ((1 + p.rangePct) / rel - 1) * 100,
      distanceToLowerPct: (rel / (1 - p.rangePct) - 1) * 100,
      equity: this.getEquity().equity,
    };
  }

  state() {
    const eq = this.getEquity();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const row = db
      .prepare(`SELECT COALESCE(SUM(pnl_usd),0) AS pnl, COUNT(*) AS n FROM positions WHERE mode=? AND status='closed' AND closed_at>=?`)
      .get(this.mode, today.getTime()) as any;
    const openPnl = this.positions.reduce((s, p) => {
      const rel = p.lastPrice / p.entryPrice;
      return s + positionValue(p.bins, rel).value + p.feesAccrued + p.feesClaimed - p.initialCapital;
    }, 0);
    const dayPnl = this.pnlPeriod("day");
    const weekPnl = this.pnlPeriod("week");
    const monthPnl = this.pnlPeriod("month");
    return {
      mode: this.mode,
      running: this.running,
      halted: this.halted,
      haltReason: this.haltReason,
      deposit: this.deposit,
      banked: this.banked,
      equity: eq.equity,
      cash: eq.cash,
      inPositions: eq.inPositions,
      pendingFees: eq.pendingFees,
      totalFees: this.totalFees(),
      pnlToday: dayPnl.pnl,
      pnlTodayPct: dayPnl.pnlPct,
      pnlWeek: weekPnl.pnl,
      pnlWeekPct: weekPnl.pnlPct,
      pnlMonth: monthPnl.pnl,
      pnlMonthPct: monthPnl.pnlPct,
      realizedToday: Number(row?.pnl ?? 0),
      unrealized: openPnl,
      tradesToday: Number(row?.n ?? 0),
      target: this.settings.targetDailyPct,
      position: this.positionDto(),
      positions: this.positions.map((p) => this.positionDto(p)),
      maxPositions: this.slots,
      slots: this.slots,
      freeSlots: Math.max(0, this.slots - this.positions.length),
      diversifyFromUsd: env.strategy.diversifyFromUsd,
      bankedTotal: this.banked,
      candidates: this.candidates.slice(0, 6),
      lastScanAt: this.lastScanAt,
      scanning: this.scanning,
      cooldownUntil: this.cooldownUntil,
      logs: this.logs.slice(0, 40),
      settings: this.settings,
    };
  }

  async chart(address: string, tf: string) {
    const cachedPool = this.positions.find((p) => p.pool.address === address)?.pool ?? null;
    const freshPool = await fetchPool(address).catch(() => null);
    const pool = freshPool ?? cachedPool;
    let candles: Candle[] = [];
    let chartError: string | null = null;
    try {
      candles = this.alignCandles(await this.getCandles(address, tf), pool?.currentPrice);
    } catch (err: any) {
      chartError = String(err?.message ?? err);
      const cached = this.candlesCache.get(`${address}:${tf}`);
      candles = cached ? this.alignCandles(cached.candles, pool?.currentPrice) : [];
    }
    const step = ((pool?.binStep ?? 100) / 10_000) || 0.01;

    // ГеокоТерминал и пул могут расходиться на десятые доли процента — а это уже половина сетки.
    // Масштабируем свечи так, чтобы последняя цена закрытия совпала с ценой пула:
    // график, бины и лестница диапазона должны жить в одной системе цен.
    const poolPx = pool?.currentPrice && pool.currentPrice > 0 ? pool.currentPrice : 0;
    const lastClose = candles[candles.length - 1]?.c ?? 0;
    if (poolPx > 0 && lastClose > 0) {
      const k = poolPx / lastClose;
      if (Math.abs(k - 1) > 1e-9) {
        candles = candles.map((c) => ({ ...c, o: c.o * k, h: c.h * k, l: c.l * k, c: c.c * k }));
      }
    }
    const priceRef = poolPx > 0 ? poolPx : lastClose || 1;
    const profile = buildVolumeProfile(candles, step, priceRef);
    const geo = await fetchGeckoPool(address);
    let binLiquidity: { price: number; usd: number }[] = [];
    if (pool) {
      try {
        const bd = await readBinLiquidity(pool, 0.12);
        binLiquidity = bd.bins.map((b) => ({ price: priceRef * b.priceRel, usd: b.usd })).filter((b) => b.price > 0);
      } catch {
        /* без ликвидности */
      }
    }
    const pair = pool ? splitPair(pool) : null;
    const supply =
      pair && pair.token.marketCap > 0 && pair.token.price > 0 ? pair.token.marketCap / pair.token.price : 0;
    const quoteUsd = pair && pair.solPrice > 0 ? pair.solPrice : 1;
    if (pool && pair) {
      swapWatcher.watch({
        pool: pool.address,
        mint: pair.token.address,
        quoteMint: pair.sol.address,
        mintDecimals: pair.token.decimals || 9,
        quoteDecimals: pair.sol.decimals || 9,
        tokenIsX: pair.solIsY,
        quoteUsd,
        createdAt: pool.createdAt,
        creator: null,
      });
    }
    return {
      tf,
      candles,
      error: chartError,
      stale: !!chartError,
      volumeProfile: profile,
      binLiquidity,
      poolTvl: pool?.tvl ?? 0,
      poolVol24: pool?.vol24 ?? 0,
      binStep: pool?.binStep ?? 100,
      currentPrice: priceRef,
      poolPrice: poolPx || priceRef,
      poolName: pool?.name ?? "",
      geo,
      supply,
      quoteUsd,
      mcFactor: supply * quoteUsd,
      priceUsdFactor: quoteUsd,
      zones: null,
      pAvgRel: null,
      exitRel: null,
      entryPrice: null,
    };
  }

  /**
   * Полная карточка пула и токена для блока «как в Meteora» на странице позиции.
   * Берём только те метрики, которые реально есть в DLMM API / GeckoTerminal / цепи —
   * ничего не выдумываем: чего нет, того нет в ответе.
   */
  async poolMetrics(address: string) {
    const cached = this.positions.find((p) => p.pool.address === address)?.pool ?? null;
    const fresh = await fetchPool(address).catch(() => null);
    const pool = fresh ?? cached;
    if (!pool) return { error: "pool not found" } as const;

    const pair = splitPair(pool);
    const geo = await fetchGeckoPool(address).catch(() => null);

    let bins: Awaited<ReturnType<typeof readBinLiquidity>> | null = null;
    try {
      bins = await readBinLiquidity(pool, 0.12);
    } catch {
      bins = null;
    }

    const step = pool.binStep / 10_000 || 0.01;
    const activeTvl = bins
      ? bins.bins.filter((b) => Math.abs(b.priceRel - 1) <= 0.02).reduce((sum, b) => sum + b.usd, 0)
      : 0;

    let volatility: number | null = null;
    let chartPrice: number | null = null;
    try {
      const candles = await this.getCandles(address, "5m");
      if (candles.length >= 16) {
        volatility = computeAtr(candles, 14);
        chartPrice = candles[candles.length - 1].c;
      }
    } catch {
      volatility = null;
    }

    const ageHours = pool.createdAt ? Math.max(0, (Date.now() - pool.createdAt) / 3_600_000) : 0;
    const totalFeePct = pool.baseFeePct + pool.dynamicFeePct;
    // ВАЖНО: active.price из DLMM SDK — это (1+step)^binId, множитель относительно бина 0,
    // а не рыночная цена. Рыночная цена активного бина = current_price пула из DLMM API.
    const poolPrice = pool.currentPrice;

    return {
      pool: {
        address: pool.address,
        name: pool.name,
        binStep: pool.binStep,
        binStepPct: step * 100,
        baseFeePct: pool.baseFeePct,
        dynamicFeePct: pool.dynamicFeePct,
        totalFeePct,
        maxFeePct: pool.maxFeePct,
        protocolFeePct: pool.protocolFeePct,
        feeToken: pair.sol.symbol,
        quote: pair.sol.symbol,
        tvl: pool.tvl,
        ageHours,
        currentPrice: poolPrice,
        chartPrice,
        priceDeltaPct:
          chartPrice && poolPrice > 0 ? (chartPrice / poolPrice - 1) * 100 : null,
      },
      fees: {
        h1: pool.fees1h,
        h12: pool.fees12h,
        h24: pool.fees24,
        tvl24: pool.feeTvl24h,
        protocol24: pool.protocolFees24,
        cumulative: pool.cumulativeFees,
      },
      token: {
        symbol: pair.token.symbol,
        address: pair.token.address,
        price: pair.token.price,
        marketCap: pair.token.marketCap,
        fdv: geo?.fdv ?? null,
        holders: pair.token.holders,
        totalSupply: pair.token.totalSupply,
        freezeDisabled: pair.token.freezeDisabled,
        verified: pair.token.verified,
        change5m: geo?.change5m ?? null,
        change1h: geo?.change1h ?? null,
        change24h: geo?.change24h ?? null,
      },
      stats: {
        activeTvl,
        feesActiveTvl: activeTvl > 0 ? (pool.fees24 / activeTvl) * 100 : 0,
        volActiveTvl: activeTvl > 0 ? (pool.vol24 / activeTvl) * 100 : 0,
        vol24: pool.vol24,
        vol1h: pool.vol1h,
        volatility,
        turnover24: pool.tvl > 0 ? (pool.vol24 / pool.tvl) * 100 : 0,
        cumulativeVolume: pool.cumulativeVolume,
      },
    };
  }
}

export const engine = new Engine();

// каждая новая сделка из WebSocket → быстрый пересчёт позиций (ребаланс/стоп реагируют за ~1 с)
swapWatcher.onSwap = () => {
  void engine.tick(true);
};
