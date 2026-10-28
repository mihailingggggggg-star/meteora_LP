import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

function loadEnvFiles() {
  const candidates = [path.join(ROOT, ".env"), path.join(ROOT, "apps/engine/.env")];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, raw] = m;
      if (process.env[k] !== undefined && process.env[k] !== "") continue;
      process.env[k] = raw.replace(/^["']|["']$/g, "");
    }
  }
}
loadEnvFiles();

const num = (v: string | undefined, def: number) => {
  if (v == null || v.trim() === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def; // «24MIN_HOLDERS=300» и прочий мусор не должен превращаться в NaN
};
const bool = (v: string | undefined, def: boolean) => (v == null ? def : v === "true");

export const env = {
  root: ROOT,
  port: num(process.env.ENGINE_PORT, 8787),
  mode: (process.env.BOT_MODE === "live" ? "live" : "demo") as "demo" | "live",
  demoDeposit: num(process.env.DEMO_DEPOSIT_USD, 500),
  rpcUrl:
    process.env.SOLANA_RPC_URL ||
    (process.env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : "https://api.mainnet-beta.solana.com"),
  meteoraApi: process.env.METEORA_DLMM_API || "https://dlmm.datapi.meteora.ag",
  geckoBase: process.env.GECKOTERMINAL_BASE || "https://api.geckoterminal.com/api/v2",
  geckoKey: process.env.GECKOTERMINAL_API_KEY || "",
  jupiterBase: process.env.JUPITER_BASE || "https://lite-api.jup.ag/swap/v1",
  strategy: {
    // ── Фаза 1: фильтры пула
    minTurnover: num(process.env.MIN_TURNOVER, 1.0), // Vol/TVL: вторичный фильтр после fee/TVL
    maxTurnover: num(process.env.MAX_TURNOVER, 40),
    // ATR(30m,14). Жёсткий «геометрический» контроль ниже: диапазон должен покрывать
    // минимум 1.5 ATR, поэтому реальный предел диктует maxRangePct, а не эта цифра.
    maxAtrPct: num(process.env.MAX_ATR_PCT, 6.5),
    minPoolTvl: num(process.env.MIN_POOL_TVL_USD, 50_000),
    minTxns24h: num(process.env.MIN_TXNS_24H, 0),
    /** максимальный шаг бина: при 150 bps и ATR 4 % диапазон ещё даёт ≥9 бинов на сторону */
    maxBinStepBps: num(process.env.MAX_BIN_STEP_BPS, 150),
    minHolders: num(process.env.MIN_HOLDERS, 300),
    minAgeHours: num(process.env.MIN_POOL_AGE_HOURS, 6),
    minVol1h: num(process.env.MIN_VOL_1H_USD, 500),

    // ── Фаза 2: вход
    budgetPct: num(process.env.POSITION_BUDGET_PCT, 50), // доля депозита на позицию
    rangeAtrMult: num(process.env.RANGE_ATR_MULT, 1.5), // ATR-множитель на 30-минутный горизонт
    maxRangePct: num(process.env.MAX_RANGE_PCT, 25.0), // максимальная полуширина диапазона, %
    /** горизонт удержания: диапазон масштабируется как ATR × √(горизонт/30м) */
    rangeHorizonHours: num(process.env.RANGE_HORIZON_HOURS, 4),
    minBinsPerSide: num(process.env.MIN_BINS_PER_SIDE, 9),
    maxBinsPerSide: num(process.env.MAX_BINS_PER_SIDE, 35),
    /** минимальная доходность пула: fee/TVL за 24ч, %/сутки (лучшая практика: 1.5–5) */
    minFeeTvlPct: num(process.env.FEE_TVL_MIN_PCT, 1.5),
    /** цена входа: своп в токеновую часть + слиппедж, % от суммы позиции */
    entryCostPct: num(process.env.ENTRY_COST_PCT, 0.3),
    /** пауза на токен после серии выходов из диапазона, часы */
    tokenCooldownHours: num(process.env.TOKEN_COOLDOWN_HOURS, 6),
    /** жёсткий стоп: на сколько % ниже нижней границы диапазона терпим, прежде чем выйти */
    hardStopPct: num(process.env.HARD_STOP_PCT, 8),
    /** минимальный размер позиции, $ (для тестов можно опустить) */
    minPositionUsd: num(process.env.MIN_POSITION_USD, 3),
    frictionPct: num(process.env.FRICTION_PCT, 0.15), // издержки свопа при ребалансе
    maxLossPerTradePct: num(process.env.MAX_LOSS_PER_TRADE_PCT, 3.0),
    maxDailyLossPct: num(process.env.MAX_DAILY_LOSS_PCT, 5.0),

    // ── Фаза 4: ребаланс
    maxRebalancesPerDay: num(process.env.MAX_REBALANCES_PER_DAY, 8),
    consecutiveLossStop: num(process.env.CONSECUTIVE_LOSS_STOP, 3),
    frictionPctRebalance: num(process.env.FRICTION_PCT, 0.15),

    // ── Фаза 3/5: ранний выход и риск
    earlyExitTurnover: num(process.env.EARLY_EXIT_TURNOVER, 0.8),
    earlyExitAtrPct: num(process.env.EARLY_EXIT_ATR_PCT, 3.0),
    profitTakePct: num(process.env.PROFIT_TAKE_PCT, 20),
    // жёсткий предел: одновременно не больше 3 позиций (каждая — своя часть депозита)
    // жёсткий предел: 2 позиции одновременно (депозит делится пополам)
    maxPositions: Math.min(2, num(process.env.MAX_POSITIONS, 2)),
    maxPositionsLarge: Math.min(2, num(process.env.MAX_POSITIONS_LARGE, 2)),
    diversifyFromUsd: num(process.env.DIVERSIFY_FROM_USD, 10_000),

    // ── служебное
    targetDailyPct: num(process.env.TARGET_DAILY_YIELD_PCT, 2.0),
    utilization: num(process.env.CAPITAL_UTILISATION, 0.85),
    // uniform = Meteora Spot (равномерно по бинам) — рекомендованный дефолт для волатильных пар.
    // "spot" у нас — колокол вокруг цены (по смыслу это Meteora Curve), "curve" — акцент на края (Bid-Ask).
    distribution: (process.env.DISTRIBUTION === "spot"
      ? "spot"
      : process.env.DISTRIBUTION === "curve"
        ? "curve"
        : "uniform") as "spot" | "curve" | "uniform",
    claimIntervalHours: num(process.env.CLAIM_INTERVAL_HOURS, 2),
    maxHoldHours: num(process.env.MAX_HOLD_HOURS, 24),
    // сколько ждём возврата цены в диапазон, прежде чем ребалансировать
    rangeBreakMinutes: num(process.env.RANGE_BREAK_MINUTES, 30),
    claimThresholdPct: num(process.env.CLAIM_THRESHOLD_PCT, 0.5),
    // ── пересмотр пула и динамический диапазон
    /** во сколько раз ATR может превысить лимит входа, прежде чем выходим, % */
    atrExitTolerancePct: num(process.env.ATR_EXIT_TOLERANCE_PCT, 20),
    /** как часто пересматриваем пул внутри позиции */
    healthCheckMinutes: num(process.env.HEALTH_CHECK_MINUTES, 5),
    /** сколько подтверждений подряд нужно, чтобы выйти по фильтрам */
    filterBreachChecks: num(process.env.FILTER_BREACH_CHECKS, 2),
    /** при каком расхождении целевого и текущего диапазона правим сетку, % */
    rangeAdjustMinPct: num(process.env.RANGE_ADJUST_MIN_PCT, 20),
    /** не чаще одного сдвига сетки за это время */
    rangeAdjustCooldownMin: num(process.env.RANGE_ADJUST_COOLDOWN_MIN, 30),
    scanIntervalSeconds: num(process.env.SCAN_INTERVAL_SECONDS, 300),
    exitCostPct: num(process.env.FRICTION_PCT, 0.15),
  },
  wsolMint: "So11111111111111111111111111111111111111112",
  /** резервный RPC: переключаемся на него, если основной вернул ошибку */
  rpcFallback: process.env.SOLANA_RPC_FALLBACK_URL || "",

  // ── боевой контур
  // Ничего из этого блока не включается само: нужны и BOT_MODE=live, и LIVE_EXECUTION=true,
  // и валидный ключ кошелька. Пока условия не выполнены — работает демо-симуляция.
  live: {
    enabled: bool(process.env.LIVE_EXECUTION, false),
    /** прогон без отправки: транзакция симулируется и логируется (репетиция на mainnet) */
    dryRun: bool(process.env.LIVE_DRY_RUN, false),
    secret: (process.env.TRADING_WALLET_SECRET_BASE58 || "").trim(),
    pubkey: (process.env.TRADING_WALLET_PUBKEY || "").trim(),
    encryptionKey: (process.env.WALLET_ENCRYPTION_KEY || "").trim(),
    /** жёсткий лимит на одну позицию в долларах (0 — без отдельного лимита) */
    maxPositionUsd: num(process.env.LIVE_MAX_POSITION_USD, 100),
    /** одновременно не больше 3 позиций */
    maxPositions: Math.min(2, num(process.env.LIVE_MAX_POSITIONS, 2)),
    slippagePct: num(process.env.LIVE_SLIPPAGE_PCT, 1.5),
    priorityFeeMicroLamports: num(process.env.LIVE_PRIORITY_FEE_MICROLAMPORTS, 50_000),
    /** сколько SOL держим на газ и аренду позиций — не тратим на ликвидность */
    minSolReserve: num(process.env.LIVE_MIN_SOL_RESERVE, 0.1),
    /** как часто сверяем состояние кошелька с базой */
    reconcileMinutes: num(process.env.LIVE_RECONCILE_MINUTES, 10),
    /** расхождение капитала, при котором останавливаемся и зовём человека, % */
    driftAlertPct: num(process.env.LIVE_DRIFT_ALERT_PCT, 5),
  },
};
