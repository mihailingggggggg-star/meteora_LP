import { env } from "./env.js";
import * as live from "./executor.js";
import { alert, alertCritical } from "./alerts.js";
import { db, event, getSetting, setSetting } from "./db.js";
import { journal, journalConfig, journalSettings, readJournal, type JournalType } from "./journal.js";
import { fetchPools, fetchPool, isSolPair, splitPair, type Pool } from "./meteora.js";
import { fetchCandles, fetchGeckoPool, fetchMeteoraCandles, jupiterQuote, type Candle } from "./market.js";
import { readBinLiquidity } from "./chain.js";
import { SwapWatcher, resolveCreator } from "./swaps.js";
import { buildVolumeProfile, priceStats } from "./math.js";
import {
  buildBalancedPlan,
  computeAtr,
  decideRangeAction,
  positionValue,
  volumeShareInRange,
  type StrategyPlan,
  type StrategySettings,
  evaluatePoolHealth,
  targetHalfRange,
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
  /** когда цена впервые вышла за границу сетки (0 — внутри диапазона) */
  outSince: number;
  /** позиция отработала срок и ждёт удачного момента для ротации */
  rotatePending: boolean;
  entryPrice: number;
  /** средняя цена входа токеновой части относительно центра сетки */
  avgEntryRel: number;
  rangePct: number;
  /** ATR на момент входа/последнего ребаланса — база для оценки дрейфа волатильности */
  entryAtrPct: number;
  /** половина диапазона на момент входа/последнего ребаланса */
  entryRangePct: number;
  /** сколько раз сетку сдвигали из-за изменения ATR (не путать с ребалансами по пробою) */
  rangeAdjusts: number;
  /** когда последний раз пересматривали пул */
  lastHealthAt: number;
  /** подпись последнего состояния — чтобы не писать одинаковые строки в журнал */
  lastHealthKey: string;
  /** сколько проверок подряд фильтры не проходят */
  breachCount: number;
  /** ждём момента, чтобы перестроить сетку под новый ATR */
  rangeNeedsAdjust: boolean;
  lastRangeAdjustAt: number;
  /** последний снимок пула из API — чтобы не запрашивать повторно в том же тике */
  freshPool?: Pool | null;
  /** суммарные комиссии на момент последнего ребаланса — для честной оценки «убыточности» */
  feesAtRebalance: number;
  /** сработал стоп серии убыточных ребалансов, но позиция в плюсе — ребалансы запрещены */
  noMoreRebalances: boolean;
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

/**
 * Белый список изменяемых настроек и допустимые границы.
 *
 * Раньше POST /api/settings слепо мержил любые ключи: из интерфейса (или из
 * локального процесса) можно было поставить maxPositions=99, отрицательный
 * депозит или frictionPct=0 — то есть обойти жёсткие лимиты риска.
 * Теперь всё, чего нет в этой таблице, отклоняется.
 */
const SETTINGS_LIMITS: Record<string, { min: number; max: number; int?: boolean }> = {
  maxAtrPct: { min: 0.1, max: 50 },
  minTurnover: { min: 0, max: 100 },
  maxTurnover: { min: 0, max: 1000 },
  minPoolTvl: { min: 0, max: 1e9 },
  minTxns24h: { min: 0, max: 1e7, int: true },
  minHolders: { min: 0, max: 1e7, int: true },
  minVol1h: { min: 0, max: 1e9 },
  minAgeHours: { min: 0, max: 1e5 },
  rangeAtrMult: { min: 0.1, max: 10 },
  maxRangePct: { min: 0.2, max: 60 },
  budgetPct: { min: 1, max: 100 },
  frictionPct: { min: 0, max: 5 },
  maxLossPerTradePct: { min: 0.1, max: 100 },
  maxDailyLossPct: { min: 0.1, max: 100 },
  utilization: { min: 0.05, max: 1 },
  // жёсткий предел: одновременно не больше 3 позиций — из UI это не обходится
  maxPositions: { min: 1, max: 2, int: true },
  maxRebalancesPerDay: { min: 0, max: 100, int: true },
  consecutiveLossStop: { min: 1, max: 20, int: true },
  earlyExitTurnover: { min: 0, max: 100 },
  earlyExitAtrPct: { min: 0, max: 100 },
  profitTakePct: { min: 0, max: 1000 },
  targetDailyPct: { min: 0, max: 100 },
  claimIntervalHours: { min: 0.1, max: 720 },
  maxHoldHours: { min: 0.5, max: 720 },
  rangeBreakMinutes: { min: 1, max: 240 },
  claimThresholdPct: { min: 0, max: 100 },
  scanIntervalSeconds: { min: 15, max: 3600 },
  atrExitTolerancePct: { min: 0, max: 200 },
  rangeHorizonHours: { min: 0.5, max: 48 },
  maxBinStepBps: { min: 5, max: 400, int: true },
  minBinsPerSide: { min: 3, max: 30, int: true },
  maxBinsPerSide: { min: 10, max: 70, int: true },
  minFeeTvlPct: { min: 0, max: 50 },
  entryCostPct: { min: 0, max: 3 },
  tokenCooldownHours: { min: 0, max: 72 },
  hardStopPct: { min: 0, max: 50 },
  minPositionUsd: { min: 0.5, max: 500 },
  healthCheckMinutes: { min: 1, max: 120 },
  filterBreachChecks: { min: 1, max: 10, int: true },
  rangeAdjustMinPct: { min: 5, max: 200 },
  rangeAdjustCooldownMin: { min: 5, max: 720 },
  exitCostPct: { min: 0, max: 10 },
};

const SETTINGS_ENUM: Record<string, string[]> = {
  distribution: ["spot", "curve", "uniform"],
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
  /** максимум капитала за всё время — база для просадки */
  peakEquity = 0;
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
  private lastSnapAt = 0;
  private scoreSeen = new Map<string, { score: number; at: number }>();
  private lastSummaryAt = 0;
  private lastSkipAt = 0;
  private haltDay = "";
  private rotCandidate: string | null = null;
  private rotChecks = 0;
  cooldownUntil = 0;
  blockedPools = new Map<string, number>();
  /** когда выходили из пула — обратно не входим 60 минут (защита от «пилы» CARDS↔CARDS) */
  recentlyClosed = new Map<string, number>();
  /** отметки времени ротаций — не больше 1 в час (churn был главной утечкой) */
  rotationMarks: number[] = [];
  /** выходы из диапазона по токену: 3 за 6 часов → пауза на токен */
  oorEvents = new Map<string, number[]>();
  tokenCooldowns = new Map<string, number>();

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
    rangeBreakMinutes: number;
    maxTurnover: number;
    atrExitTolerancePct: number;
    maxBinStepBps: number;
    rangeHorizonHours: number;
    minBinsPerSide: number;
    maxBinsPerSide: number;
    minFeeTvlPct: number;
    entryCostPct: number;
    tokenCooldownHours: number;
    hardStopPct: number;
    minPositionUsd: number;
    distribution: "spot" | "curve" | "uniform";
    healthCheckMinutes: number;
    filterBreachChecks: number;
    rangeAdjustMinPct: number;
    rangeAdjustCooldownMin: number;
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
    rangeBreakMinutes: env.strategy.rangeBreakMinutes ?? 10,
    maxTurnover: env.strategy.maxTurnover ?? 40,
    atrExitTolerancePct: env.strategy.atrExitTolerancePct ?? 20,
    maxBinStepBps: env.strategy.maxBinStepBps ?? 150,
    rangeHorizonHours: env.strategy.rangeHorizonHours ?? 4,
    minBinsPerSide: env.strategy.minBinsPerSide ?? 9,
    maxBinsPerSide: env.strategy.maxBinsPerSide ?? 35,
    minFeeTvlPct: env.strategy.minFeeTvlPct ?? 1.5,
    entryCostPct: env.strategy.entryCostPct ?? 0.3,
    tokenCooldownHours: env.strategy.tokenCooldownHours ?? 6,
    hardStopPct: env.strategy.hardStopPct ?? 8,
    minPositionUsd: env.strategy.minPositionUsd ?? 1,
    // форма распределения по бинам: uniform = Meteora Spot (дефолт), spot у нас = колокол (Curve)
    distribution: env.strategy.distribution,
    healthCheckMinutes: env.strategy.healthCheckMinutes ?? 5,
    filterBreachChecks: env.strategy.filterBreachChecks ?? 2,
    rangeAdjustMinPct: env.strategy.rangeAdjustMinPct ?? 20,
    rangeAdjustCooldownMin: env.strategy.rangeAdjustCooldownMin ?? 30,
  };

  /** Сколько позиций держим одновременно: 1 до $10k, дальше — диверсификация. */
  get slots(): number {
    // жёсткий предел: не больше 2 позиций одновременно, независимо от депозита
    const base = Math.max(1, Math.min(2, this.settings.maxPositions));
    if (this.deposit >= env.strategy.diversifyFromUsd) {
      return Math.min(2, Math.max(base, env.strategy.maxPositionsLarge));
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
    if (savedSettings) {
      const merged: any = { ...this.settings, ...savedSettings };
      // жёсткий предел: не больше 2 позиций, даже если в базе сохранено старое значение (например 3)
      const savedSlots = Number(merged.maxPositions);
      merged.maxPositions = Number.isFinite(savedSlots) ? Math.min(2, Math.max(1, savedSlots)) : 2;
      merged.maxHoldHours = Number(merged.maxHoldHours) || env.strategy.maxHoldHours || 24;
      merged.rangeBreakMinutes = Number(merged.rangeBreakMinutes) || env.strategy.rangeBreakMinutes || 10;
      this.settings = merged;
    }
    // жёсткий предел 2 слота проверяем вне блока сохранённых настроек:
    // значение могло прийти из .env (MAX_POSITIONS) или из старой базы (3)
    if (this.settings.maxPositions > 2) {
      this.settings.maxPositions = 2;
      setSetting("engine.settings", this.settings);
      journal("BOOT", "жёсткий предел: слотов не больше 2 (было больше)");
    }
    this.restore();
    this.reconcile();
    this.reconcileCash();
    this.seedLogs();
    journalConfig({
      mode: this.mode,
      deposit: this.deposit,
      slots: this.slots,
      maxHoldHours: this.settings.maxHoldHours,
      rangeBreakMinutes: this.settings.rangeBreakMinutes,
      strategy: {
        rangeAtrMult: this.settings.rangeAtrMult,
        maxRangePct: this.settings.maxRangePct,
        budgetPct: this.settings.budgetPct,
        frictionPct: this.settings.frictionPct,
        maxLossPerTradePct: this.settings.maxLossPerTradePct,
        maxDailyLossPct: this.settings.maxDailyLossPct,
        maxRebalancesPerDay: this.settings.maxRebalancesPerDay,
        consecutiveLossStop: this.settings.consecutiveLossStop,
        claimIntervalHours: this.settings.claimIntervalHours,
        profitTakePct: this.settings.profitTakePct,
        targetDailyPct: this.settings.targetDailyPct,
      },
      filters: {
        maxAtrPct: this.settings.maxAtrPct,
        minTurnover: this.settings.minTurnover,
        minPoolTvl: this.settings.minPoolTvl,
        minTxns24h: this.settings.minTxns24h,
        minHolders: this.settings.minHolders,
        minVol1h: this.settings.minVol1h,
        minAgeHours: this.settings.minAgeHours,
        maxTurnover: this.settings.maxTurnover,
        // выход по фильтрам: допуск по ATR и число подтверждений подряд
        atrExitTolerancePct: this.settings.atrExitTolerancePct,
        filterBreachChecks: this.settings.filterBreachChecks,
      },
      rangeDynamics: {
        feeTvlMinPct: this.settings.minFeeTvlPct,
        rangeHorizonHours: this.settings.rangeHorizonHours,
        minBinsPerSide: this.settings.minBinsPerSide,
        maxBinsPerSide: this.settings.maxBinsPerSide,
        maxBinStepBps: this.settings.maxBinStepBps,
        entryCostPct: this.settings.entryCostPct,
        tokenCooldownHours: this.settings.tokenCooldownHours,
        distribution: this.settings.distribution,
        healthCheckMinutes: this.settings.healthCheckMinutes,
        rangeAtrMult: this.settings.rangeAtrMult,
        maxRangePct: this.settings.maxRangePct,
        rangeAdjustMinPct: this.settings.rangeAdjustMinPct,
        rangeAdjustCooldownMin: this.settings.rangeAdjustCooldownMin,
      },
      settings: this.settings,
    });
    journal(
      "CONFIG",
      "параметры при старте",
      {
        mode: this.mode,
        deposit: this.deposit,
        slots: this.slots,
        cash: this.cash,
        banked: this.banked,
        maxHoldHours: this.settings.maxHoldHours,
        rangeBreakMinutes: this.settings.rangeBreakMinutes,
        maxRebalancesPerDay: this.settings.maxRebalancesPerDay,
        consecutiveLossStop: this.settings.consecutiveLossStop,
        maxDailyLossPct: this.settings.maxDailyLossPct,
        maxLossPerTradePct: this.settings.maxLossPerTradePct,
        maxAtrPct: this.settings.maxAtrPct,
        atrExitTolerancePct: this.settings.atrExitTolerancePct,
        filterBreachChecks: this.settings.filterBreachChecks,
        healthCheckMinutes: this.settings.healthCheckMinutes,
        rangeAtrMult: this.settings.rangeAtrMult,
        rangeAdjustMinPct: this.settings.rangeAdjustMinPct,
        rangeAdjustCooldownMin: this.settings.rangeAdjustCooldownMin,
        minTurnover: this.settings.minTurnover,
        claimIntervalHours: this.settings.claimIntervalHours,
        profitTakePct: this.settings.profitTakePct,
      },
    );
    journal(
      "BOOT",
      `движок запущен mode=${this.mode} deposit=$${this.deposit.toFixed(2)} слотов=${this.slots} сетка±${(this.settings.maxRangePct / 2).toFixed(1)}% ребаланс=${this.settings.maxRebalancesPerDay}/сут ожидание=${this.settings.rangeBreakMinutes}мин`,
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
            binStep: row.bin_step ?? 100,
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
          outSince: 0,
          rotatePending: false,
          entryPrice: row.entry_price,
          avgEntryRel: 1,
          rangePct: row.range_pct ?? 0.025,
          entryAtrPct: row.entry_atr_pct ?? row.atr_pct ?? 0,
          entryRangePct: row.entry_range_pct ?? row.range_pct ?? 0.025,
          rangeAdjusts: row.range_adjusts ?? 0,
          lastHealthAt: 0,
          lastHealthKey: "",
          breachCount: 0,
          rangeNeedsAdjust: false,
          lastRangeAdjustAt: row.last_range_adjust_at ?? 0,
          freshPool: null,
          feesAtRebalance: row.fees_at_rebalance ?? (row.fees_usd ?? 0) + (row.claimed_usd ?? 0),
          noMoreRebalances: false,
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

  /**
   * Сверка кэша. Инвариант:
   *   капитал = депозит + Σ закрытых PnL + Σ открытых (снятые комиссии − вложено) − отложено
   * Если после рестарта/старых багов кэш разошёлся — правим и пишем в журнал.
   */
  private reconcileCash() {
    try {
      const closed = db
        .prepare(`SELECT COALESCE(SUM(pnl_usd),0) AS pnl FROM positions WHERE mode=? AND status='closed'`)
        .get(this.mode) as any;
      const openAdj = this.positions.reduce((sum, p) => sum + p.feesClaimed - p.initialCapital, 0);
      const expected = this.deposit + Number(closed?.pnl ?? 0) + openAdj - this.banked;
      const delta = expected - this.cash;
      if (Math.abs(delta) <= 0.02) return;

      // защита от абсурдных значений (например, если в базе старые расчёты)
      if (Math.abs(delta) > Math.max(50, this.deposit)) {
        journal(
          "WARN",
          `сверка капитала: кэш $${this.cash.toFixed(2)}, по расчёту $${expected.toFixed(2)} — разница слишком большая, не правлю`,
        );
        return;
      }

      journal(
        "WARN",
        `сверка капитала: кэш $${this.cash.toFixed(2)} → $${expected.toFixed(2)} (разница ${delta >= 0 ? "+" : ""}$${delta.toFixed(2)})`,
      );
      this.cash = expected;
      this.persist();
    } catch {
      /* сверка не должна ронять запуск */
    }
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
      journal("HALT", `дневной убыток $${pnl.toFixed(2)} ≤ лимита −$${limit.toFixed(2)} → новые входы остановлены до завтра`, {
        dayPnl: pnl,
        limit,
        deposit: this.deposit,
        maxDailyLossPct: this.settings.maxDailyLossPct,
      });
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
      const funnel = {
        sol: 0, black: 0, tvl: 0, freeze: 0, holders: 0, turnover: 0, age: 0, atr: 0, flow: 0, blocked: 0,
        feeTvl: 0, binStep: 0,
      };

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
        // ГЛАВНЫЙ фильтр доходности: сколько комиссий приносит доллар TVL за сутки.
        // Объём сам по себе ничего не значит: при base fee 0.1 % и обороте 5xTVL
        // доходность 0.5 %/сут, чего не хватает даже на окупаемость одного ребаланса.
        const feeTvlPct = p.feeTvl24h > 0 ? p.feeTvl24h : p.tvl > 0 ? (p.fees24 / p.tvl) * 100 : 0;
        if (feeTvlPct < st.minFeeTvlPct) return (funnel.feeTvl++, false);
        // шаг бина: при слишком крупном шаге целевой диапазон даёт < 9 бинов на сторону
        if (p.binStep > st.maxBinStepBps) return (funnel.binStep++, false);
        // пауза на токен после серии выходов из диапазона
        if ((this.tokenCooldowns.get(pairInfo.token.address) ?? 0) > now) return (funnel.blocked++, false);
        if (p.vol1h < st.minVol1h) return (funnel.flow++, false);
        const blockedUntil = this.blockedPools.get(p.address) ?? 0;
        if (blockedUntil > now) return (funnel.blocked++, false);
        // только что вышли из этого пула — минимум час не возвращаемся
        if ((this.recentlyClosed.get(p.address) ?? 0) > now) return (funnel.blocked++, false);
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
        `пулов ${pools.length} → отсев [не SOL ${funnel.sol}, black ${funnel.black}, TVL ${funnel.tvl}, freeze ${funnel.freeze}, холдеры ${funnel.holders}, оборот ${funnel.turnover}, fee/TVL ${funnel.feeTvl}, шаг ${funnel.binStep}, возраст ${funnel.age}, блок ${funnel.blocked}] → прошли ${passed.length} → разобрано ${analysed.length} → лучший ${
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
  /**
   * Ротация в более доходный пул — ИСКЛЮЧЕНИЕ, а не режим работы.
   *
   * Что было не так (журнал 27–28.10): 35 ротаций за 14 часов, медиана жизни позиции
   * 34 минуты, средний результат −$0.50; один CARDS-SOL дал 13 кругов и −$14.81.
   * Причина — сравнение мгновенного liveDailyPct молодой позиции (медиана 1.1 %/сут,
   * то есть шум) с оптимистичным прогнозом лучшего пула: коэффициент «×3…×16» возникал
   * почти всегда, и бот менял позицию, платя слиппедж 0.27 % и фиксируя IL.
   *
   * Теперь ротация требует одновременно:
   *  1) позиция пожила ≥ 90 минут (за 30–40 минут комиссии не окупают круг);
   *  2) цена не ниже входа (rel ≥ 0.995) — не фиксируем убыток по телу;
   *  3) сравнение по max(живой темп, 60 % прогноза), а не по мгновенному шуму;
   *  4) прогноз лучшего пула ≥ 3.5× текущего;
   *  5) прирост за 6 часов в долларах больше стоимости круга (выход+вход ≈ 0.6 %);
   *  6) не больше 3 ротаций в час;
   *  7) не входим в пул, который покинули меньше часа назад.
   */
  private async maybeRotate(analysed: StrategyPlan[]) {
    const best = analysed[0];
    if (!best) return;
    const now = Date.now();

    if ((this.recentlyClosed.get(best.pool.address) ?? 0) > now) return;
    this.rotationMarks = this.rotationMarks.filter((t) => now - t < 3600_000);
    if (this.rotationMarks.length >= 1) return;

    const worst = [...this.positions].sort((a, b) => this.positionRate(a) - this.positionRate(b))[0];
    if (!worst) return;
    if (worst.pool.address === best.pool.address) return;
    if (now - worst.openedAt < 90 * 60_000) return;

    const rel = worst.lastPrice / worst.entryPrice;
    if (rel < 0.995) return; // выходить в минус по телу ради «лучшего» пула — запрещено

    const currentRate = Math.max(this.positionRate(worst), worst.predictedDailyPct * 0.6);
    const gain = best.expectedDailyPct / Math.max(0.05, currentRate);
    const minGain = 3.5;
    if (gain < minGain) {
      this.rotCandidate = null;
      this.rotChecks = 0;
      return;
    }

    // окупаемость в деньгах: прирост за 6 часов против стоимости круга (≈0.6 % капитала)
    const hoursToHold = 6;
    const extraUsd = ((best.expectedDailyPct - currentRate) / 100 / 24) * hoursToHold * worst.capital;
    const roundTripUsd = worst.capital * 0.006;
    if (extraUsd < roundTripUsd) {
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
    this.rotationMarks.push(now);
    journal(
      "EXIT_ROTATE",
      `pos#${worst.id} ${worst.pool.name} даёт ${currentRate.toFixed(2)}%/сут (живой ${this.positionRate(worst).toFixed(2)}), а ${best.pool.name} — ${best.expectedDailyPct.toFixed(2)}%/сут (×${gain.toFixed(1)}) · возраст ${((now - worst.openedAt) / 60_000).toFixed(0)} мин · rel ${rel.toFixed(4)} · выгода за 6ч ≈ $${extraUsd.toFixed(2)} против круга $${roundTripUsd.toFixed(2)} → ротация`,
      {
        position: worst.id,
        from: worst.pool.name,
        to: best.pool.name,
        currentRate,
        liveRate: this.positionRate(worst),
        bestRate: best.expectedDailyPct,
        gain,
        rel,
        ageMinutes: (now - worst.openedAt) / 60_000,
        extraUsd,
        roundTripUsd,
        rotationsLastHour: this.rotationMarks.length,
      },
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
    const spend = Math.min(plan.capital, this.cash, perSlot);
    const minPos = this.settings.minPositionUsd ?? 1;
    if (spend < minPos) {
      // раньше здесь был молчаливый return — в журнале не было видно, почему вход не состоялся
      journal("SKIP", `сумма $${spend.toFixed(2)} меньше минимума $${minPos} — ${plan.pool.name} пропущен`, {
        spend: Number(spend.toFixed(2)),
        minPositionUsd: minPos,
        capital: plan.capital,
        cash: this.cash,
        perSlot,
      });
      return;
    }
    // Издержки входа. Симметричный диапазон требует ОБЕ стороны, то есть половину
    // суммы надо обменять в токен: Jupiter-своп + слиппедж (0.2–0.4 %). Раньше это
    // было ноль — при 52 входах набегало ~$25 «невидимых» потерь.
    const entryCost = spend * (this.settings.entryCostPct / 100);
    const capital = Math.max(1, spend - entryCost);

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
    db.prepare(
      `UPDATE positions SET initial_capital = ?, friction_usd = ?, entry_atr_pct = ?, entry_range_pct = ?, bin_step = ?, fees_at_rebalance = 0 WHERE id = ?`,
    ).run(spend, entryCost, plan.atrPct, plan.rangePct, plan.pool.binStep, id);

    const bins: RtBin[] = plan.bins.map((b) => ({
      k: b.k,
      priceRel: b.priceRel,
      usd: b.usd * (capital / plan.capital),
      poolUsd: b.poolUsd ?? 0,
      feePerDay: b.feePerDay * (capital / plan.capital),
    }));

    this.cash -= spend;
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
      initialCapital: spend,
      frictionPaid: entryCost,
      vol30m: 0,
      outSince: 0,
      rotatePending: false,
      entryPrice,
      avgEntryRel: 1,
      rangePct: plan.rangePct,
      entryAtrPct: plan.atrPct,
      entryRangePct: plan.rangePct,
      rangeAdjusts: 0,
      lastHealthAt: 0,
      lastHealthKey: "",
      breachCount: 0,
      rangeNeedsAdjust: false,
      lastRangeAdjustAt: 0,
      freshPool: null,
      feesAtRebalance: 0,
      noMoreRebalances: false,
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

    // ── боевой контур: та же позиция, но реальной ликвидностью в пуле.
    // Если транзакция не прошла — откатываем запись, останавливаемся и зовём человека:
    // «фантомная» позиция в базе опаснее, чем пропущенная сделка.
    if (live.armed()) {
      try {
        const ks = plan.bins.map((b) => b.k);
        await live.openPosition({
          positionId: id,
          pool: plan.pool,
          capitalUsd: capital,
          minK: Math.min(...ks),
          maxK: Math.max(...ks),
          solPriceUsd: pair.solPrice > 0 ? pair.solPrice : 200,
        });
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        // «Недостаточно средств» и лимиты слотов — это не авария, а нормальное состояние
        // (вывели SOL, позиция уже занята). Такую попытку просто откатываем без HALT.
        const soft = /недостаточно SOL|нет нужных токенов|лимит позиций|сумма позиции слишком мала|jupiter/i.test(msg);
        if (env.live.dryRun || soft) {
          journal("WARN", `pos#${id}: вход не выполнен (${msg}) — откат, продолжаем`, {
            position: id,
            pool: plan.pool.name,
            error: msg,
          });
          db.prepare(`DELETE FROM positions WHERE id = ?`).run(id);
          this.positions = this.positions.filter((p) => p.id !== id);
          this.cash += spend;
          this.persist();
          return;
        }
        journal("ERROR", `pos#${id}: открытие в цепочке не удалось — ${msg}`, { position: id, pool: plan.pool.name, error: msg });
        this.halted = true;
        this.haltReason = `live open: ${msg}`;
        db.prepare(`DELETE FROM positions WHERE id = ?`).run(id);
        this.positions = this.positions.filter((p) => p.id !== id);
        this.cash += capital;
        this.persist();
        await alertCritical(`Не удалось открыть позицию ${plan.pool.name}: ${msg}\nТорговля остановлена.`);
        return;
      }
    }

    this.persist();

    journal(
      "ENTER",
      `pos#${id} ${plan.pool.name} C=$${spend.toFixed(0)} (вход $${entryCost.toFixed(2)}) 50/50 диапазон ±${(plan.rangePct * 100).toFixed(1)}% ${plan.bins.length} бинов (концентрация ×${Math.round(plan.concentration)}) прогноз ${plan.expectedDailyPct.toFixed(2)}%/сут ATR ${plan.atrPct.toFixed(2)}% fee/TVL ${plan.pool.feeTvl24h.toFixed(2)}%`,
      {
        position: id,
        pool: plan.pool.name,
        capital: spend,
        netCapital: capital,
        entryCost,
        bins: plan.bins.length,
        price: entryPrice,
        rangePct: plan.rangePct,
        atrPct: plan.atrPct,
        predictedDailyPct: plan.expectedDailyPct,
        poolTvl: plan.pool.tvl,
        vol24: plan.pool.vol24,
        binStep: plan.pool.binStep,
        baseFeePct: plan.pool.baseFeePct,
        dynamicFeePct: plan.pool.dynamicFeePct,
        slotsUsed: this.positions.length,
        cash: this.cash,
      },
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
  /**
   * Пересмотр позиции и перестройка сетки.
   *
   * Перед ребалансом пул анализируется заново — теми же жёсткими фильтрами, что и на входе:
   *  • фильтры больше не проходят → выходим (EXIT_FILTERS), а не «чиним» безнадёжный пул;
   *  • проходят → строим новую сетку под свежий ATR: диапазон = rangeAtrMult × ATR
   *    в границах [1%, maxRangePct], капитал — по актуальному риск-лимиту и ликвидности коридора.
   *
   * cause: RANGE_BREAK — цена вышла за границу и не вернулась;
   *        RANGE_ADJUST — ATR ушёл, и сетка перестала соответствовать волатильности.
   */
  private async rebalance(pos: RtPos, price: number, cause: "RANGE_BREAK" | "RANGE_ADJUST" = "RANGE_BREAK") {
    const now = Date.now();
    const rel = price / pos.entryPrice;

    // ── 1. свежие данные пула (не «на память» с момента входа)
    const freshPool = await fetchPool(pos.pool.address).catch(() => null);
    if (!freshPool) {
      journal(
        "WARN",
        `pos#${pos.id}: пул не отдал данные — ${cause === "RANGE_ADJUST" ? "правка диапазона отложена" : "ребаланс отложен"}`,
        { position: pos.id, cause },
      );
      return;
    }
    const candles = this.alignCandles(await this.getCandles(pos.pool.address, "30m"), freshPool.currentPrice);
    const health = evaluatePoolHealth({
      pool: freshPool,
      candles30m: candles,
      settings: this.settings,
      atrAtEntry: pos.entryAtrPct,
      rangePct: pos.rangePct,
      atrTolerancePct: this.settings.atrExitTolerancePct,
      now,
    });

    const scope = cause === "RANGE_ADJUST" ? "правкой диапазона" : "ребалансом";
    journal(
      "HEALTH",
      `pos#${pos.id} ${pos.tokenSymbol} пересмотр перед ${scope}: ${health.verdict} · ATR ${health.atrPct.toFixed(2)}% (вход ${health.atrAtEntry.toFixed(2)}%, ${health.atrDriftPct >= 0 ? "+" : ""}${health.atrDriftPct.toFixed(0)}%) · диапазон ±${(health.rangePctNow * 100).toFixed(2)}% → цель ±${(health.rangePctTarget * 100).toFixed(2)}% · fee/TVL ${health.feeTvlPct.toFixed(2)}%/сут · оборот ${health.turnover24.toFixed(2)}x · TVL $${Math.round(health.tvl)}`,
      {
        position: pos.id,
        cause,
        verdict: health.verdict,
        atrPct: health.atrPct,
        atrAtEntry: health.atrAtEntry,
        atrDriftPct: health.atrDriftPct,
        rangePctNow: health.rangePctNow,
        rangePctTarget: health.rangePctTarget,
        rangeDriftPct: health.rangeDriftPct,
        turnover24: health.turnover24,
        tvl: health.tvl,
        inRangeShare: health.inRangeShare,
        failed: health.failed.map((c) => `${c.key}=${Number(c.value.toFixed(2))}${c.unit} при лимите ${Number(c.limit.toFixed(2))}${c.unit}`),
        warn: health.warn.map((c) => c.key),
      },
    );
    pos.lastHealthAt = now;
    pos.lastHealthKey = health.signature;

    // ── 2. условия входа больше не выполняются → выходим, ребаланс не поможет
    const failText = health.failed
      .map((c) => `${c.label} ${Number(c.value.toFixed(2))}${c.unit} (лимит ${Number(c.limit.toFixed(2))}${c.unit})`)
      .join("; ");
    if (health.verdict === "hard") {
      journal(
        "EXIT_FILTERS",
        `pos#${pos.id} ${pos.tokenSymbol}: условия входа больше не выполняются — ${failText} → выходим вместо ${scope}`,
        {
          position: pos.id,
          cause,
          price,
          rel,
          atrPct: health.atrPct,
          atrAtEntry: health.atrAtEntry,
          turnover24: health.turnover24,
          tvl: health.tvl,
          failed: health.failed.map((c) => ({ key: c.key, value: c.value, limit: c.limit, unit: c.unit })),
        },
      );
      this.blockedPools.set(pos.pool.address, now + 60 * 60_000);
      await this.closePositionById(pos.id, "EXIT_FILTERS", price);
      return;
    }

    // ── 3. новая сетка из свежих ATR / ликвидности / комиссий
    const binData =
      (await readBinLiquidity(freshPool, 0.08).catch(() => null)) ??
      ({ activePrice: freshPool.currentPrice, bins: [], source: "estimate" } as const);

    const plan = buildBalancedPlan({
      pool: freshPool,
      candles30m: candles,
      binData: { activePrice: binData.activePrice, bins: [...binData.bins], source: binData.source },
      deposit: this.deposit,
      settings: this.settings,
    });
    if (!plan) {
      journal(
        "EXIT_FILTERS",
        `pos#${pos.id} ${pos.tokenSymbol}: после пересмотра капитал/риск не сходятся (ATR ${health.atrPct.toFixed(2)}%, целевой диапазон ±${(health.rangePctTarget * 100).toFixed(2)}%) → выход`,
        { position: pos.id, cause, price, rel, atrPct: health.atrPct, rangePctTarget: health.rangePctTarget },
      );
      this.blockedPools.set(pos.pool.address, now + 60 * 60_000);
      await this.closePositionById(pos.id, "EXIT_FILTERS", price);
      return;
    }

    // ── 4. применяем: капитал, диапазон, распределение, счётчики
    const { value } = positionValue(pos.bins, rel);
    const frictionUsd = value * (this.settings.frictionPct / 100);
    // новый размер ограничен и риск-лимитом под новый ATR, и ликвидностью коридора (plan.capital)
    const newCapital = Math.max(0, Math.min(value - frictionUsd, plan.capital));
    // «убыточный» ребаланс считаем по NET с прошлого ребаланса: изменение капитала
    // ПЛЮС комиссии, заработанные за это время. Раньше смотрели только тело позиции —
    // из-за этого LMAO с +$41 комиссий набирала «серию убытков» и закрывалась в +23 вместо +36.
    const feesNow = pos.feesAccrued + pos.feesClaimed;
    const feesSince = Math.max(0, feesNow - pos.feesAtRebalance);
    const netSince = newCapital - pos.capital + feesSince;
    const lost = netSince < -Math.max(0.5, pos.capital * 0.002);

    const oldCapital = pos.capital;
    const oldRange = pos.rangePct;
    const oldAtr = pos.entryAtrPct;
    const outMinutes = pos.outSince ? (now - pos.outSince) / 60_000 : null;
    const scale = newCapital / Math.max(1e-9, plan.capital);

    const pair = splitPair(freshPool);
    if (pair.token.price > 0) pos.tokenPriceUsd = pair.token.price;
    if (pair.solPrice > 0) pos.solPriceUsd = pair.solPrice;
    if (pair.token.decimals) pos.tokenDecimals = pair.token.decimals;

    pos.capital = newCapital;
    pos.entryPrice = price;
    pos.avgEntryRel = plan.avgEntryPriceRel;
    pos.rangePct = plan.rangePct;
    pos.entryRangePct = plan.rangePct;
    pos.entryAtrPct = plan.atrPct;
    pos.atrPct = plan.atrPct;
    pos.turnover24 = plan.turnover24;
    pos.predictedDailyPct = plan.expectedDailyPct;
    pos.inRangeShare = plan.inRangeShare;
    pos.pool = freshPool;
    pos.bins = plan.bins.map((b) => ({
      k: b.k,
      priceRel: b.priceRel,
      usd: b.usd * scale,
      poolUsd: b.poolUsd ?? 0,
      feePerDay: b.feePerDay * scale,
    }));
    pos.filled = new Set<number>();
    pos.breakChecks = 0;
    pos.rebalances += 1;
    pos.frictionPaid += frictionUsd;
    pos.consecutiveLosses = lost ? pos.consecutiveLosses + 1 : 0;
    if (cause === "RANGE_ADJUST") {
      pos.rangeAdjusts += 1;
      pos.lastRangeAdjustAt = now;
    } else {
      pos.lastRebalanceAt = now;
    }
    pos.rangeNeedsAdjust = false;
    pos.outSince = 0;
    pos.feesAtRebalance = feesNow;

    db.prepare(
      `UPDATE positions SET capital=?, entry_price=?, p_avg_price=?, p_exit=?, bins=?, rebalances=?, consecutive_losses=?, friction_usd=?, range_pct=?, atr_pct=?, entry_atr_pct=?, entry_range_pct=?, range_adjusts=?, last_range_adjust_at=?, bin_step=?, fees_at_rebalance=?, updated_at=? WHERE id=?`,
    ).run(
      pos.capital,
      pos.entryPrice,
      pos.entryPrice,
      pos.entryPrice * (1 - pos.rangePct),
      JSON.stringify(pos.bins),
      pos.rebalances,
      pos.consecutiveLosses,
      pos.frictionPaid,
      pos.rangePct,
      pos.atrPct,
      pos.entryAtrPct,
      pos.entryRangePct,
      pos.rangeAdjusts,
      pos.lastRangeAdjustAt,
      freshPool.binStep,
      pos.feesAtRebalance,
      Date.now(),
      pos.id,
    );

    const type = cause === "RANGE_ADJUST" ? "RANGE_ADJUST" : "REBALANCE";
    const rangeNote =
      Math.abs(plan.rangePct - oldRange) > 1e-6
        ? `диапазон ±${(oldRange * 100).toFixed(2)}% → ±${(plan.rangePct * 100).toFixed(2)}%`
        : `диапазон ±${(plan.rangePct * 100).toFixed(2)}% (без изменений)`;
    journal(
      type,
      `pos#${pos.id} ${pos.tokenSymbol} ${cause === "RANGE_ADJUST" ? "правка диапазона" : "ребаланс"} #${pos.rebalances}: цена ${((rel - 1) * 100).toFixed(2)}% · ${rangeNote} · ATR ${oldAtr.toFixed(2)}% → ${plan.atrPct.toFixed(2)}% · капитал $${oldCapital.toFixed(0)}→$${pos.capital.toFixed(0)} (friction $${frictionUsd.toFixed(2)}) · серия убытков ${pos.consecutiveLosses}`,
      {
        position: pos.id,
        cause,
        price,
        rel,
        fromCapital: oldCapital,
        toCapital: pos.capital,
        frictionUsd,
        rangeFromPct: oldRange * 100,
        rangeToPct: plan.rangePct * 100,
        atrFromPct: oldAtr,
        atrToPct: plan.atrPct,
        atrDriftPct: health.atrDriftPct,
        rebalances: pos.rebalances,
        rangeAdjusts: pos.rangeAdjusts,
        consecutiveLosses: pos.consecutiveLosses,
        netSinceRebalance: netSince,
        feesSinceRebalance: feesSince,
        binsCount: pos.bins.length,
        expectedDailyPct: plan.expectedDailyPct,
        outMinutes,
        lost,
      },
    );
    event(pos.id, type, {
      price,
      rel,
      fromCapital: oldCapital,
      toCapital: pos.capital,
      frictionUsd,
      rangeFromPct: oldRange * 100,
      rangeToPct: plan.rangePct * 100,
      atrFromPct: oldAtr,
      atrToPct: plan.atrPct,
      cause,
    });

    if (pos.consecutiveLosses >= this.settings.consecutiveLossStop) {
      const posPnl = pos.capital + pos.feesAccrued + pos.feesClaimed - pos.initialCapital;
      // прибыльную позицию стопом не режем: фиксировать IL и издержки на плюсе — худшее,
      // что можно сделать. Вместо выхода запрещаем дальнейшие ребалансы.
      if (posPnl > 0) {
        if (!pos.noMoreRebalances) {
          pos.noMoreRebalances = true;
          journal(
            "STOP",
            `pos#${pos.id} ${pos.consecutiveLosses} ребаланса подряд в минус по телу, но позиция в плюсе +$${posPnl.toFixed(2)} → ребалансы запрещены, держим до выхода по фильтрам/ротации`,
            { position: pos.id, consecutiveLosses: pos.consecutiveLosses, posPnl, price, rel, action: "block_rebalances" },
          );
        }
        return;
      }
      journal("STOP", `pos#${pos.id} ${pos.consecutiveLosses} убыточных ребаланса подряд (net −$${Math.abs(netSince).toFixed(2)}) → полный выход и смена пула`, {
        position: pos.id,
        consecutiveLosses: pos.consecutiveLosses,
        stopAfter: this.settings.consecutiveLossStop,
        netSince,
        posPnl,
        price,
        rel,
      });
      this.blockedPools.set(pos.pool.address, Date.now() + 30 * 60_000);
      await this.closePositionById(pos.id, "CONSECUTIVE_LOSS", price);
      return;
    }
    if (pos.rebalances >= this.settings.maxRebalancesPerDay) {
      journal("STOP", `pos#${pos.id} лимит ребалансов ${this.settings.maxRebalancesPerDay}/сут → выход`, {
        position: pos.id,
        rebalances: pos.rebalances,
        limit: this.settings.maxRebalancesPerDay,
        price,
        rel,
      });
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

  /**
   * Периодический пересмотр пула внутри позиции (раз в healthCheckMinutes).
   *
   * 1. Считаем те же жёсткие фильтры, что и на входе (ATR, TVL, оборот, объём, держатели, rug).
   *    Провал подтверждается filterBreachChecks раз подряд (защита от одного плохого ответа API);
   *    катастрофические значения (TVL/объём вдвое ниже лимита, ATR выше лимита в 1.5 раза,
   *    падение больше 60%) закрывают позицию сразу.
   * 2. Если ATR ушёл так, что диапазон перестал соответствовать волатильности,
   *    перестраиваем сетку (RANGE_ADJUST) — но только когда цена внутри диапазона
   *    и прошёл кулдаун, иначе это двойная работа на пробое.
   * 3. Всё, что изменилось, пишется в журнал: HEALTH / RANGE_ADJUST / EXIT_FILTERS.
   *
   * @returns true, если позиция закрыта или перестроена (дальше в тике делать нечего)
   */
  private async monitorConditions(pos: RtPos, price: number, now: number): Promise<boolean> {
    const everyMs = Math.max(1, this.settings.healthCheckMinutes) * 60_000;
    if (now - pos.lastHealthAt < everyMs) return false;
    pos.lastHealthAt = now;

    const pool = pos.freshPool ?? (await fetchPool(pos.pool.address).catch(() => null));
    if (!pool) return false;

    const candles = this.alignCandles(await this.getCandles(pos.pool.address, "30m"), price);
    const health = evaluatePoolHealth({
      pool,
      candles30m: candles,
      settings: this.settings,
      atrAtEntry: pos.entryAtrPct,
      rangePct: pos.rangePct,
      atrTolerancePct: this.settings.atrExitTolerancePct,
      now,
    });

    // живые метрики позиции
    pos.atrPct = health.atrPct;
    pos.turnover24 = health.turnover24;
    pos.inRangeShare = health.inRangeShare || pos.inRangeShare;

    // журнал: пишем при смене состояния, но не чаще раза в 30 минут при «том же»
    const changed = health.signature !== pos.lastHealthKey;
    const stale = now - ((pos as any).lastHealthLogAt ?? 0) > 30 * 60_000;
    if (changed || stale) {
      (pos as any).lastHealthLogAt = now;
      pos.lastHealthKey = health.signature;
      const failNote = health.failed.length
        ? ` · провал: ${health.failed.map((c) => `${c.label} ${Number(c.value.toFixed(2))}${c.unit} при лимите ${Number(c.limit.toFixed(2))}${c.unit}`).join(", ")}`
        : health.warn.length
          ? ` · внимание: ${health.warn.map((c) => c.key).join(", ")}`
          : "";
      journal(
        "HEALTH",
        `pos#${pos.id} ${pos.tokenSymbol}: ${health.verdict.toUpperCase()} · ATR ${health.atrPct.toFixed(2)}% (вход ${health.atrAtEntry.toFixed(2)}%, ${health.atrDriftPct >= 0 ? "+" : ""}${health.atrDriftPct.toFixed(0)}%) · диапазон ±${(pos.rangePct * 100).toFixed(2)}% (цель ±${(health.rangePctTarget * 100).toFixed(2)}%) · ${pos.bins.length} бинов · fee/TVL ${health.feeTvlPct.toFixed(2)}%/сут · оборот ${health.turnover24.toFixed(2)}x · TVL $${Math.round(health.tvl)} · в коридоре ${(health.inRangeShare * 100).toFixed(0)}%${failNote}`,
        {
          position: pos.id,
          verdict: health.verdict,
          atrPct: health.atrPct,
          atrAtEntry: health.atrAtEntry,
          atrDriftPct: health.atrDriftPct,
          rangePct: pos.rangePct * 100,
          rangePctTarget: health.rangePctTarget * 100,
          rangeDriftPct: health.rangeDriftPct,
          turnover24: health.turnover24,
          tvl: health.tvl,
          inRangeShare: health.inRangeShare,
          feeTvlPct: health.feeTvlPct,
          bins: pos.bins.length,
          change24h: health.change24h,
          failed: health.failed.map((c) => ({ key: c.key, value: c.value, limit: c.limit })),
          warn: health.warn.map((c) => c.key),
          breachCount: pos.breachCount,
        },
      );
    }

    // ── 1. жёсткие фильтры
    if (health.verdict === "hard") {
      pos.breachCount += 1;
      const confirmations = Math.max(1, Math.round(this.settings.filterBreachChecks));
      const catastrophic = health.failed.some((c) => {
        if (c.key === "data") return true;
        if (c.key === "rug") return c.value < -60;
        if (c.key === "atr") return c.value > c.limit * 1.5;
        return c.value < c.limit * 0.5;
      });
      if (pos.breachCount >= confirmations || catastrophic) {
        const why = health.failed
          .map((c) => `${c.label} ${Number(c.value.toFixed(2))}${c.unit} (лимит ${Number(c.limit.toFixed(2))}${c.unit})`)
          .join("; ");
        journal(
          "EXIT_FILTERS",
          `pos#${pos.id} ${pos.tokenSymbol}: фильтры входа перестали проходить — ${why} (проверок подряд: ${pos.breachCount}${catastrophic ? ", катастрофическое значение" : ""}) → выход`,
          {
            position: pos.id,
            price,
            rel: price / pos.entryPrice,
            atrPct: health.atrPct,
            atrAtEntry: health.atrAtEntry,
            turnover24: health.turnover24,
            tvl: health.tvl,
            breachCount: pos.breachCount,
            confirmations,
            catastrophic,
            failed: health.failed.map((c) => ({ key: c.key, value: c.value, limit: c.limit, unit: c.unit })),
          },
        );
        this.blockedPools.set(pos.pool.address, now + 60 * 60_000);
        await this.closePositionById(pos.id, "EXIT_FILTERS", price);
        return true;
      }
      journal("WARN", `pos#${pos.id} фильтры не проходят (${pos.breachCount}/${confirmations}) — ждём подтверждения`, {
        position: pos.id,
        breachCount: pos.breachCount,
        failed: health.failed.map((c) => c.key),
      });
      return false;
    }
    pos.breachCount = 0;

    // ── 2. пул «остыл» (оборот/комиссии) — отдельная мягкая проверка, как раньше
    // «пул остыл»: раньше проверяли мгновенный liveDailyPct — за 10–15 минут комиссии
    // не успевают начислиться, это шум (9 сделок закрылись в среднем за 11 минут, −$6.49).
    // Теперь: не раньше 45 минут жизни и по накопленному темпу за всю жизнь позиции.
    const ageH = (now - pos.openedAt) / 3600_000;
    const cumRate = ageH > 0.05 ? ((pos.feesAccrued + pos.feesClaimed) / Math.max(1, pos.capital) / ageH) * 24 * 100 : 0;
    const feeDrop = ageH >= 1 && cumRate < Math.max(0.4, pos.predictedDailyPct * 0.35);
    const quietPool = ageH >= 0.75 && pos.turnover24 > 0 && pos.turnover24 < this.settings.earlyExitTurnover;
    const tooQuiet = quietPool || feeDrop;
    pos.lowConditionChecks = tooQuiet ? pos.lowConditionChecks + 1 : 0;
    if (pos.lowConditionChecks >= 2) {
      journal(
        "STOP",
        `pos#${pos.id} условия ухудшились (ATR ${health.atrPct.toFixed(2)}%, оборот ${pos.turnover24.toFixed(2)}x, накопленный темп ${cumRate.toFixed(2)}%/сут за ${ageH.toFixed(1)}ч) → выход`,
        { position: pos.id, atrPct: health.atrPct, turnover24: pos.turnover24, cumRate, ageH, liveDailyPct: pos.liveDailyPct },
      );
      await this.closePositionById(pos.id, "EXIT_FLOW", price);
      return true;
    }

    // ── 3. диапазон не соответствует текущему ATR → перестраиваем сетку
    const rangeDrift = Math.abs(health.rangeDriftPct);
    const bigEnough = rangeDrift >= Math.max(5, this.settings.rangeAdjustMinPct);
    const cooldownOk = now - pos.lastRangeAdjustAt >= Math.max(5, this.settings.rangeAdjustCooldownMin) * 60_000;
    const inside = Math.abs(price / pos.entryPrice - 1) < pos.rangePct * 0.9;
    if (!bigEnough) return false;

    if (!cooldownOk) {
      if (changed) {
        journal(
          "RANGE_ADJUST",
          `pos#${pos.id} диапазон ±${(pos.rangePct * 100).toFixed(2)}% не соответствует ATR (цель ±${(health.rangePctTarget * 100).toFixed(2)}%) — ждём кулдаун ${this.settings.rangeAdjustCooldownMin} мин`,
          {
            position: pos.id,
            phase: "defer",
            atrPct: health.atrPct,
            rangePct: pos.rangePct * 100,
            rangePctTarget: health.rangePctTarget * 100,
            rangeDriftPct: health.rangeDriftPct,
            cooldownMin: this.settings.rangeAdjustCooldownMin,
          },
        );
      }
      return false;
    }
    if (!inside) {
      // цена у края/за диапазоном — этим занимается логика пробоя (10 минут и ребаланс)
      return false;
    }
    if (pos.rebalances >= this.settings.maxRebalancesPerDay) return false;

    pos.rangeNeedsAdjust = true;
    await this.rebalance(pos, price, "RANGE_ADJUST");
    return true;
  }

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
        if (fresh) pos.freshPool = fresh;
        if (fresh && fresh.currentPrice > 0) {
          apiPrice = fresh.currentPrice;
          pos.lastApiPrice = apiPrice;
          pos.lastApiAt = now;
          if (fresh.tvl > 0) pos.pool.tvl = fresh.tvl;
          if (fresh.vol24 > 0) pos.pool.vol24 = fresh.vol24;
          if (fresh.vol1h >= 0) pos.pool.vol1h = fresh.vol1h;
          if (fresh.binStep > 0) pos.pool.binStep = fresh.binStep;
          if (fresh.fees24 >= 0) pos.pool.fees24 = fresh.fees24;
          if (fresh.feeTvl24h >= 0) pos.pool.feeTvl24h = fresh.feeTvl24h;
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
      if (live.armed()) {
        try {
          await live.claimFees(pos.id, pos.pool.address);
        } catch (err: any) {
          journal("ERROR", `pos#${pos.id}: клейм в цепочке не удался — ${err?.message ?? err}`, {
            position: pos.id,
            error: String(err?.message ?? err),
          });
          await alert(`клейм pos#${pos.id} не выполнен: ${err?.message ?? err}`, `claim-${pos.id}`);
          return; // комиссии остаются в feesAccrued — повторим на следующем тике
        }
      }
      const claimed = pos.feesAccrued;
      pos.feesClaimed += claimed;
      pos.feesAccrued = 0;
      this.cash += claimed;
      this.persist(); // без этого после рестарта кэш откатывался и капитал был ниже PnL
      pos.claimedAt = now;
      db.prepare(`UPDATE positions SET fees_usd=?, claimed_usd=?, last_claim_at=? WHERE id=?`).run(0, pos.feesClaimed, now, pos.id);
      event(pos.id, "CLAIM", { claimed });
      journal("CLAIM", `pos#${pos.id} комиссии $${claimed.toFixed(2)} → SOL`, {
        position: pos.id,
        claimed,
        totalClaimed: pos.feesClaimed,
        cash: this.cash,
      });
    }

    // ── лимит времени в сделке
    // ── срок отработан: НЕ закрываем принудительно, ждём удачного момента
    // (цена вернулась к центру — фиксируем, или пробила диапазон вниз — выходим)
    if (
      this.settings.maxHoldHours > 0 &&
      now - pos.openedAt > this.settings.maxHoldHours * 3600_000 &&
      !pos.rotatePending
    ) {
      pos.rotatePending = true;
      journal(
        "ROTATE_WAIT",
        `pos#${pos.id} отработала ${this.settings.maxHoldHours}ч → ждём баланса или пробоя вниз; слот не освобождаем принудительно`,
      );
    }

    // ── жёсткий стоп по цене: диапазон не защищает от дампа, а стоп — защищает.
    // Проверяем каждый тик (5 секунд), не дожидаясь грейса и пересмотра фильтров.
    if (this.settings.hardStopPct > 0) {
      const lower = pos.entryPrice * (1 - pos.rangePct);
      const stopPrice = lower * (1 - this.settings.hardStopPct / 100);
      if (price > 0 && price < stopPrice) {
        journal(
          "EXIT_STOP",
          `pos#${pos.id} жёсткий стоп: цена ${((price / lower - 1) * 100).toFixed(2)}% ниже нижней границы диапазона (порог −${this.settings.hardStopPct}%) → выходим`,
          {
            position: pos.id,
            price,
            lower,
            stopPrice,
            rel: price / pos.entryPrice,
            hardStopPct: this.settings.hardStopPct,
            pnl: this.positionDto(pos)?.pnl ?? null,
          },
        );
        this.blockedPools.set(pos.pool.address, now + 2 * 3600_000);
        await this.closePositionById(pos.id, "EXIT_STOP", price);
        return;
      }
    }

    // ── выход за границу сетки: сначала ждём grace, ребаланс только если не вернулась
    if (now - pos.openedAt < 60_000) return;
    const graceMs = Math.max(1, this.settings.rangeBreakMinutes) * 60_000;
    const action = decideRangeAction({
      rel,
      rangePct: pos.rangePct,
      outSince: pos.outSince,
      now,
      graceMs,
      rotatePending: pos.rotatePending,
    });

    if (action === "mark_out") {
      pos.outSince = now;
      journal(
        "RANGE_OUT",
        `pos#${pos.id} цена вышла за границу (${((rel - 1) * 100).toFixed(2)}%) → ждём ${this.settings.rangeBreakMinutes} мин`,
        { position: pos.id, price, rel, rangePct: pos.rangePct, outMinutes: 0 },
      );
      // серия выходов по одному токену = он не держит диапазон; пауза на токен (лучшая практика: 12ч)
      const sixHoursAgo = now - 6 * 3600_000;
      const prev = (this.oorEvents.get(pos.tokenMint) ?? []).filter((t) => t > sixHoursAgo);
      prev.push(now);
      this.oorEvents.set(pos.tokenMint, prev);
      const cdHours = Math.max(0, this.settings.tokenCooldownHours);
      if (cdHours > 0 && prev.length >= 3 && (this.tokenCooldowns.get(pos.tokenMint) ?? 0) < now) {
        this.tokenCooldowns.set(pos.tokenMint, now + cdHours * 3600_000);
        journal(
          "WARN",
          `токен ${pos.tokenSymbol}: ${prev.length} выхода из диапазона за 6ч → пауза ${cdHours}ч (не входим снова, пока не успокоится)`,
          { token: pos.tokenSymbol, mint: pos.tokenMint, exits: prev.length, cooldownHours: cdHours },
        );
      }
    } else if (action === "back_in") {
      journal(
        "RANGE_BACK",
        `pos#${pos.id} цена вернулась в диапазон за ${Math.round((now - pos.outSince) / 1000)}с — ребаланс не нужен`,
      );
      pos.outSince = 0;
    } else if (action === "rebalance") {
      if (pos.noMoreRebalances) {
        if (!(pos as any).noRebLogged) {
          (pos as any).noRebLogged = true;
          journal("WARN", `pos#${pos.id} пробой диапазона, но ребалансы запрещены (стоп серии на плюсе) — держим до выхода по фильтрам/ротации`, {
            position: pos.id,
            price,
            rel,
          });
        }
        return;
      }
      await this.rebalance(pos, price);
      return;
    } else if (action === "close_rotate") {
      journal("EXIT_ROTATE", `pos#${pos.id} цена вернулась к центру — фиксируем и освобождаем слот`, {
        position: pos.id,
        price,
        rel,
        outMinutes: pos.outSince ? (now - pos.outSince) / 60_000 : 0,
      });
      await this.closePositionById(pos.id, "EXIT_ROTATE", price);
      return;
    } else if (action === "close_range_down") {
      journal("EXIT_RANGE_DOWN", `pos#${pos.id} пробой вниз держится ${this.settings.rangeBreakMinutes} мин → выходим`, {
        position: pos.id,
        price,
        rel,
        outMinutes: pos.outSince ? (now - pos.outSince) / 60_000 : 0,
      });
      await this.closePositionById(pos.id, "EXIT_RANGE_DOWN", price);
      return;
    }

    // ── пересмотр пула: жёсткие фильтры, «остывание» и соответствие диапазона ATR
    if (await this.monitorConditions(pos, price, now)) return;

    // ── срез состояния раз в 5 минут: по нему видно, как менялся капитал и просадка
    if (now - this.lastSnapAt > 5 * 60_000) {
      this.lastSnapAt = now;
      const eq = this.getEquity();
      if (eq.equity > this.peakEquity) this.peakEquity = eq.equity;
      const dd = this.peakEquity > 0 ? ((eq.equity - this.peakEquity) / this.peakEquity) * 100 : 0;
      const openPnl = this.positions.reduce((sum, p) => sum + (this.positionDto(p)?.pnl ?? 0), 0);
      journal("SNAP", `equity=$${eq.equity.toFixed(2)} cash=$${eq.cash.toFixed(2)} открытых=${this.positions.length} pnl_открытых=$${openPnl.toFixed(2)} dd=${dd.toFixed(2)}%`, {
        equity: eq.equity,
        cash: eq.cash,
        inPositions: eq.inPositions,
        pendingFees: eq.pendingFees,
        banked: eq.banked,
        peakEquity: this.peakEquity,
        drawdownPct: dd,
        openPnl,
        deposit: this.deposit,
        totalPnl: eq.equity - this.deposit,
        positions: this.positions.map((p) => ({
          id: p.id,
          pool: p.pool.name,
          price: p.lastPrice,
          rel: p.lastPrice / p.entryPrice,
          pnl: this.positionDto(p)?.pnl ?? 0,
          fees: p.feesAccrued + p.feesClaimed,
          rebalances: p.rebalances,
          rangeAdjusts: p.rangeAdjusts,
          entryAtrPct: p.entryAtrPct,
          atrPct: p.atrPct,
          rotatePending: p.rotatePending,
        })),
      });
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

    // в боевом режиме сначала выходим из пула, и только потом фиксируем результат в базе
    if (live.armed()) {
      try {
        await live.closePosition(pos.id, pos.pool.address, reason);
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        journal("ERROR", `pos#${pos.id}: выход из пула не удался — ${msg}`, { position: pos.id, reason, error: msg });
        this.halted = true;
        this.haltReason = `live close: ${msg}`;
        await alertCritical(
          `Не удалось закрыть pos#${pos.id} (${pos.pool.name}): ${msg}\nПозиция осталась в пуле, торговля остановлена.`,
        );
        return;
      }
    }

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
      {
        position: pos.id,
        pool: pos.pool.name,
        reason,
        price,
        entryPrice: pos.entryPrice,
        rel: price / pos.entryPrice,
        pnl,
        pnlPct,
        feesAccrued: pos.feesAccrued,
        feesClaimed: pos.feesClaimed,
        capital: pos.capital,
        initialCapital: pos.initialCapital,
        frictionPaid: pos.frictionPaid,
        rebalances: pos.rebalances,
        hours,
        exitSlipPct: slipPct * 100,
        slipSource,
        equity: this.getEquity().equity,
      },
    );
    this.log(reason, `pos#${pos.id} закрыта: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);

    // после выхода не входим в этот пул 60 минут — защита от «пилы» (13 кругов CARDS-SOL)
    this.recentlyClosed.set(pos.pool.address, Date.now() + 60 * 60_000);
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

  /**
   * Полный сброс демо-контура: закрыть все открытые позиции, очистить историю
   * (сделки, события, срезы капитала, кандидаты, цепочные операции), поставить
   * депозит заново и СОХРАНИТЬ состояние — иначе после рестарта касса вернётся
   * из state.json и «чистый лист» не наступит.
   */
  async resetDemo(): Promise<{ before: { deposit: number; cash: number; positions: number }; after: { deposit: number; cash: number } }> {
    const before = { deposit: this.deposit, cash: this.cash, positions: this.positions.length };
    for (const p of [...this.positions]) {
      try {
        await this.closePositionById(p.id, "MANUAL", p.lastPrice);
      } catch {
        /* закрываем что можем — ниже всё равно чистим базу */
      }
    }
    this.positions = [];
    db.prepare(`DELETE FROM positions WHERE mode='demo'`).run();
    db.prepare(`DELETE FROM equity WHERE mode='demo'`).run();
    db.prepare(`DELETE FROM position_events`).run();
    db.prepare(`DELETE FROM candidates`).run();
    try {
      db.prepare(`DELETE FROM onchain_ops`).run();
    } catch {
      /* таблицы может не быть в старой базе */
    }

    this.deposit = env.demoDeposit;
    this.cash = env.demoDeposit;
    this.banked = 0;
    this.peakEquity = env.demoDeposit;
    this.nextMilestone = env.demoDeposit * 1.1;
    this.halted = false;
    this.haltReason = null;
    this.cooldownUntil = 0;
    this.blockedPools.clear();
    this.recentlyClosed.clear();
    this.rotationMarks = [];
    this.oorEvents.clear();
    this.tokenCooldowns.clear();
    this.persist();
    this.snapshotEquityNow();
    journal("BOOT", `история сброшена, старт с $${env.demoDeposit}`, {
      before,
      deposit: this.deposit,
      cash: this.cash,
    });
    return { before, after: { deposit: this.deposit, cash: this.cash } };
  }

  /**
   * В live капитал для расчёта размера позиции берём С КОШЕЛЬКА, а не из демо-настройки.
   * Иначе бот планирует сделку на $500 при 0.5 SOL на счету и падает с «недостаточно SOL».
   * Обновляем только когда открытых позиций нет (чтобы не сбить учёт).
   */
  async syncLiveCapital(force = false): Promise<void> {
    if (this.mode !== "live" || !live.armed()) return;
    if (this.positions.length > 0) return;
    try {
      const bal = await live.walletBalance();
      if (!bal || bal.totalUsd <= 0) return;
      const usd = Math.max(10, bal.totalUsd);
      if (!force && Math.abs(usd - this.deposit) / Math.max(1, this.deposit) <= 0.03) return;
      journal(
        "BOOT",
        `live: торговый капитал по кошельку $${usd.toFixed(2)} (SOL ${bal.sol.toFixed(3)} ≈ $${bal.solUsd.toFixed(2)}, токенов на $${(usd - bal.solUsd).toFixed(2)}) — было $${this.deposit.toFixed(2)}`,
        { deposit: usd, sol: bal.sol, solUsd: bal.solUsd, previous: this.deposit },
      );
      this.deposit = usd;
      this.cash = usd;
      this.peakEquity = usd;
      this.nextMilestone = usd * 1.1;
      this.persist();
      this.snapshotEquityNow();
    } catch {
      /* нет RPC — оставляем как есть */
    }
  }

  /** Ручной старт/пауза с сохранением состояния (иначе после рестарта вернётся halted=true). */
  setRunning(run: boolean): void {
    this.running = run;
    if (run) {
      this.halted = false;
      this.haltReason = null;
    }
    this.persist();
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
    // banked — прибыль, отложенная «на холодный кошелёк»: это тот же капитал, просто вне риска
    return this.cash + this.totalLiveValue() + fees + this.banked;
  }

  getEquity() {
    const inPositions = this.totalLiveValue();
    const pendingFees = this.positions.reduce((s, p) => s + p.feesAccrued, 0);
    return {
      equity: this.cash + inPositions + pendingFees + this.banked,
      cash: this.cash,
      inPositions,
      pendingFees,
      banked: this.banked,
    };
  }

  totalFees(): number {
    const row = db
      .prepare(`SELECT COALESCE(SUM(fees_usd),0) + COALESCE(SUM(claimed_usd),0) AS f FROM positions WHERE mode = ?`)
      .get(this.mode) as any;
    return Number(row?.f ?? 0);
  }

  /** Обновление настроек: пишем в журнал только изменённые параметры. */
  /**
   * Патч настроек: только известные ключи, только значения в допустимых пределах.
   * Неизвестные параметры и выход за границы отклоняются и возвращаются в `rejected`
   * (интерфейс показывает их, журнал фиксирует причину).
   */
  applySettings(patch: Record<string, unknown>) {
    const prev = { ...this.settings } as Record<string, any>;
    const next: Record<string, any> = { ...prev };
    const accepted: string[] = [];
    const rejected: { key: string; value: unknown; reason: string }[] = [];

    for (const [key, raw] of Object.entries(patch ?? {})) {
      if (SETTINGS_ENUM[key]) {
        const value = String(raw);
        if (!SETTINGS_ENUM[key].includes(value)) {
          rejected.push({ key, value: raw, reason: `допустимо: ${SETTINGS_ENUM[key].join(" | ")}` });
          continue;
        }
        next[key] = value;
        accepted.push(key);
        continue;
      }

      const rule = SETTINGS_LIMITS[key];
      if (!rule) {
        rejected.push({ key, value: raw, reason: "неизвестный параметр" });
        continue;
      }

      const value = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").trim());
      if (!Number.isFinite(value)) {
        rejected.push({ key, value: raw, reason: "не число" });
        continue;
      }
      const scaled = rule.int ? Math.round(value) : value;
      const clamped = Math.min(rule.max, Math.max(rule.min, scaled));
      if (clamped !== value) rejected.push({ key, value: raw, reason: `ограничено до ${clamped}` });
      next[key] = clamped;
      accepted.push(key);
    }

    if (!accepted.length) {
      return { changed: [], rejected, settings: this.settings };
    }

    this.settings = next as typeof this.settings;
    journalSettings(prev, next);
    setSetting("engine.settings", this.settings);
    if (rejected.length) {
      journal("SETTINGS", `отклонены параметры: ${rejected.map((r) => `${r.key} (${r.reason})`).join(", ")}`, {
        rejected,
      });
    }
    return { changed: accepted, rejected, settings: this.settings };
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
      deposit: this.deposit,
      banked: this.banked,
      pnl,
      pnlPct: equityStart > 0 ? (pnl / equityStart) * 100 : 0,
      realized,
      unrealized,
      trades: Number(closed?.n ?? 0),
      series: series.map((r) => ({ ts: r.ts, equity: r.equity })),
    };
  }

  /** Аудит капитала: все слагаемые и расхождение. */
  audit() {
    const eq = this.getEquity();
    const closed = db
      .prepare(
        `SELECT COALESCE(SUM(pnl_usd),0) AS pnl, COALESCE(SUM(fees_usd),0) AS fees, COALESCE(SUM(claimed_usd),0) AS claimed, COUNT(*) AS n
         FROM positions WHERE mode=? AND status='closed'`,
      )
      .get(this.mode) as any;
    const open = this.positions.map((p) => {
      const dto = this.positionDto(p);
      return {
        id: p.id,
        name: p.pool.name,
        capital: p.initialCapital,
        value: dto?.value ?? 0,
        feesAccrued: p.feesAccrued,
        feesClaimed: p.feesClaimed,
        pnl: dto?.pnl ?? 0,
        realized: dto?.realizedPnl ?? 0,
        unrealized: dto?.unrealizedPnl ?? 0,
      };
    });
    const openPnl = open.reduce((s, p) => s + p.pnl, 0);
    const expected = this.deposit + Number(closed?.pnl ?? 0) + openPnl;
    return {
      mode: this.mode,
      deposit: this.deposit,
      cash: eq.cash,
      inPositions: eq.inPositions,
      pendingFees: eq.pendingFees,
      banked: eq.banked,
      equity: eq.equity,
      closedPnl: Number(closed?.pnl ?? 0),
      closedTrades: Number(closed?.n ?? 0),
      closedFees: Number(closed?.fees ?? 0) + Number(closed?.claimed ?? 0),
      openPnl,
      open,
      expectedEquity: expected,
      delta: eq.equity - expected,
    };
  }

  snapshotEquityNow() {
    const eq = this.getEquity();
    db.prepare(
      `INSERT INTO equity (ts, mode, equity, cash, in_positions, fees_cum, banked) VALUES (?,?,?,?,?,?,?)`,
    ).run(Date.now(), this.mode, eq.equity, eq.cash, eq.inPositions, this.totalFees(), this.banked);
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
      rangeAdjusts: p.rangeAdjusts,
      entryAtrPct: p.entryAtrPct,
      feeTvlPct: p.pool.feeTvl24h,
      rangeCoverAtr: p.rangePct > 0 && p.atrPct > 0 ? p.rangePct * 100 / p.atrPct : 0,
      maxRebalances: this.settings.maxRebalancesPerDay,
      consecutiveLosses: p.consecutiveLosses,
      consecutiveLossStop: this.settings.consecutiveLossStop,
      binsCount: p.bins.length,
      activeBins: p.filled.size,
      atrExitPct: this.settings.earlyExitAtrPct,
      atrExitTolerancePct: this.settings.atrExitTolerancePct,
      rangePctTarget: targetHalfRange(p.atrPct, this.settings),
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
      rangeBreakMinutes: this.settings.rangeBreakMinutes,
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
