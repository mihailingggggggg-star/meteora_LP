import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { env } from "./env.js";

const dir = path.join(env.root, "data");
fs.mkdirSync(dir, { recursive: true });


export const db = new DatabaseSync(path.join(dir, "engine.db"));

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  pool TEXT NOT NULL,
  pool_name TEXT,
  token_symbol TEXT,
  token_mint TEXT,
  status TEXT NOT NULL,
  capital REAL NOT NULL,
  entry_price REAL,
  p_avg REAL,
  p_exit REAL,
  exit_price REAL,
  zones TEXT,
  bins TEXT,
  opened_at INTEGER,
  closed_at INTEGER,
  fees_usd REAL DEFAULT 0,
  claimed_usd REAL DEFAULT 0,
  il_usd REAL DEFAULT 0,
  pnl_usd REAL DEFAULT 0,
  pnl_pct REAL DEFAULT 0,
  exit_reason TEXT,
  predicted_15h REAL DEFAULT 0,
  t_r REAL DEFAULT 0,
  r_share REAL DEFAULT 0,
  fee_pct REAL DEFAULT 0,
  vol24 REAL DEFAULT 0,
  last_price REAL,
  last_claim_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS position_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_ev_pos ON position_events(position_id, ts);

CREATE TABLE IF NOT EXISTS equity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  mode TEXT NOT NULL,
  equity REAL NOT NULL,
  cash REAL NOT NULL,
  in_positions REAL NOT NULL,
  fees_cum REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eq_ts ON equity(ts);

CREATE TABLE IF NOT EXISTS pos_alloc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  sol_usd REAL NOT NULL,
  token_usd REAL NOT NULL,
  price REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alloc_pos ON pos_alloc(position_id, ts);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  pool TEXT NOT NULL,
  pool_name TEXT,
  score REAL,
  r15 REAL,
  rday REAL,
  t_r REAL,
  capital REAL,
  vol24 REAL,
  fee_pct REAL,
  accepted INTEGER DEFAULT 0,
  reason TEXT,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_cand_ts ON candidates(ts);

CREATE TABLE IF NOT EXISTS swaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool TEXT NOT NULL,
  sig TEXT NOT NULL UNIQUE,
  slot INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  side TEXT NOT NULL,
  token_amount REAL NOT NULL,
  quote_amount REAL NOT NULL,
  price_quote REAL NOT NULL,
  price_usd REAL NOT NULL,
  value_usd REAL NOT NULL,
  labels TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_swaps_pool ON swaps(pool, ts DESC);

CREATE TABLE IF NOT EXISTS wallet_labels (
  pool TEXT NOT NULL,
  wallet TEXT NOT NULL,
  labels TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (pool, wallet)
);

CREATE TABLE IF NOT EXISTS pool_early (
  pool TEXT PRIMARY KEY,
  done_at INTEGER NOT NULL,
  reliable INTEGER NOT NULL DEFAULT 0,
  parsed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// миграции для уже существующих баз
for (const ddl of [
  `ALTER TABLE positions ADD COLUMN last_claim_at INTEGER`,
  `ALTER TABLE positions ADD COLUMN p_avg_price REAL`,
  `ALTER TABLE positions ADD COLUMN actual_fee_pct_daily REAL`,
  `ALTER TABLE positions ADD COLUMN exit_slip_pct REAL`,
  `ALTER TABLE positions ADD COLUMN range_pct REAL`,
  `ALTER TABLE positions ADD COLUMN atr_pct REAL`,
  `ALTER TABLE positions ADD COLUMN turnover24 REAL`,
  `ALTER TABLE positions ADD COLUMN entry_kind TEXT`,
  `ALTER TABLE positions ADD COLUMN rebalances INTEGER DEFAULT 0`,
  `ALTER TABLE positions ADD COLUMN consecutive_losses INTEGER DEFAULT 0`,
  `ALTER TABLE positions ADD COLUMN initial_capital REAL`,
  `ALTER TABLE positions ADD COLUMN friction_usd REAL`,
]) {
  try {
    db.exec(ddl);
  } catch {
    /* колонка уже есть */
  }
}

export function event(positionId: number | null, type: string, payload?: unknown) {
  db.prepare(`INSERT INTO position_events (position_id, ts, type, payload) VALUES (?, ?, ?, ?)`).run(
    positionId ?? 0,
    Date.now(),
    type,
    payload ? JSON.stringify(payload) : null,
  );
}

export function getSetting<T>(key: string, def: T): T {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as any;
  if (!row) return def;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return def;
  }
}

export function setSetting(key: string, value: unknown) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(value));
}

// ── миграции ──
// отложенная прибыль должна попадать в капитал, иначе кривая капитала «падает» при фиксации
try {
  db.exec(`ALTER TABLE equity ADD COLUMN banked REAL DEFAULT 0`);
} catch {
  /* колонка уже есть */
}
