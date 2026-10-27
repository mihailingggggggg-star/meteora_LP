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
    minTurnover: num(process.env.MIN_TURNOVER, 3.0), // Vol/TVL ≥ 3.0 (идеально 5–10)
    maxTurnover: num(process.env.MAX_TURNOVER, 40),
    maxAtrPct: num(process.env.MAX_ATR_PCT, 2.0), // ATR(30m,14) ≤ 2.0%
    minPoolTvl: num(process.env.MIN_POOL_TVL_USD, 50_000),
    minTxns24h: num(process.env.MIN_TXNS_24H, 0),
    minHolders: num(process.env.MIN_HOLDERS, 300),
    minAgeHours: num(process.env.MIN_POOL_AGE_HOURS, 6),
    minVol1h: num(process.env.MIN_VOL_1H_USD, 500),

    // ── Фаза 2: вход
    budgetPct: num(process.env.POSITION_BUDGET_PCT, 50), // доля депозита на позицию
    rangeAtrMult: num(process.env.RANGE_ATR_MULT, 1.5), // диапазон = 1.5 × ATR
    maxRangePct: num(process.env.MAX_RANGE_PCT, 5.0), // полная ширина диапазона, %
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
    maxPositions: Math.min(3, num(process.env.MAX_POSITIONS, 3)),
    maxPositionsLarge: num(process.env.MAX_POSITIONS_LARGE, 5),
    diversifyFromUsd: num(process.env.DIVERSIFY_FROM_USD, 10_000),

    // ── служебное
    targetDailyPct: num(process.env.TARGET_DAILY_YIELD_PCT, 2.0),
    utilization: num(process.env.CAPITAL_UTILISATION, 0.85),
    distribution: (process.env.DISTRIBUTION === "curve"
      ? "curve"
      : process.env.DISTRIBUTION === "uniform"
        ? "uniform"
        : "spot") as "spot" | "curve" | "uniform",
    claimIntervalHours: num(process.env.CLAIM_INTERVAL_HOURS, 2),
    maxHoldHours: num(process.env.MAX_HOLD_HOURS, 24),
    // сколько ждём возврата цены в диапазон, прежде чем ребалансировать
    rangeBreakMinutes: num(process.env.RANGE_BREAK_MINUTES, 10),
    claimThresholdPct: num(process.env.CLAIM_THRESHOLD_PCT, 0.5),
    scanIntervalSeconds: num(process.env.SCAN_INTERVAL_SECONDS, 45),
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
    secret: (process.env.TRADING_WALLET_SECRET_BASE58 || "").trim(),
    pubkey: (process.env.TRADING_WALLET_PUBKEY || "").trim(),
    encryptionKey: (process.env.WALLET_ENCRYPTION_KEY || "").trim(),
    /** жёсткий лимит на одну позицию в долларах (0 — без отдельного лимита) */
    maxPositionUsd: num(process.env.LIVE_MAX_POSITION_USD, 100),
    /** одновременно не больше 3 позиций */
    maxPositions: Math.min(3, num(process.env.LIVE_MAX_POSITIONS, 3)),
    slippagePct: num(process.env.LIVE_SLIPPAGE_PCT, 1.5),
    priorityFeeMicroLamports: num(process.env.LIVE_PRIORITY_FEE_MICROLAMPORTS, 50_000),
    /** сколько SOL держим на газ и аренду позиций — не тратим на ликвидность */
    minSolReserve: num(process.env.LIVE_MIN_SOL_RESERVE, 0.03),
    /** как часто сверяем состояние кошелька с базой */
    reconcileMinutes: num(process.env.LIVE_RECONCILE_MINUTES, 10),
    /** расхождение капитала, при котором останавливаемся и зовём человека, % */
    driftAlertPct: num(process.env.LIVE_DRIFT_ALERT_PCT, 5),
  },
};
