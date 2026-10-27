import { env } from "./env.js";
import { db } from "./db.js";
import { journal } from "./journal.js";
import { fetchPool } from "./meteora.js";
import { solanaStream } from "./stream.js";
import { decodeSwapFromLogs } from "./dlmmEvents.js";

export type SwapRow = {
  pool: string;
  sig: string;
  slot: number;
  ts: number;
  wallet: string;
  side: "buy" | "sell";
  tokenAmount: number;
  quoteAmount: number;
  priceQuote: number;
  priceUsd: number;
  valueUsd: number;
  labels: string[];
};

export type WatchCtx = {
  pool: string;
  mint: string;
  quoteMint: string;
  mintDecimals: number;
  quoteDecimals: number;
  tokenIsX: boolean;
  decX: number;
  decY: number;
  quoteUsd: number;
  lastPriceQuote?: number;
  createdAt: number;
  creator: string | null;
  lastSig: string | null;
  seen: Set<string>;
  earlyDone: boolean;
  earlyReliable: boolean;
  lastAccountAt?: number;
  lastUsed: number;
  busy: boolean;
};

const DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

// ── ограничитель: бесплатный тариф Helius ~10 rps, держим запас
let lastRpcAt = 0;
let rpcQueue: Promise<any> = Promise.resolve();
function throttleRpc<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = Math.max(0, 140 - (Date.now() - lastRpcAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastRpcAt = Date.now();
    return fn();
  };
  const p = rpcQueue.then(run, run);
  rpcQueue = p.catch(() => {});
  return p as Promise<T>;
}

async function rpc(method: string, params: any[]): Promise<any> {
  return throttleRpc(async () => {
  const res = await fetch(env.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? "rpc error");
  return data.result;
  });
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** Метка «создатель» — из Metaplex authorities токена (DAS getAsset). */
export async function resolveCreator(mint: string): Promise<string | null> {
  try {
    const res = await rpc("getAsset", [{ id: mint }]);
    const auth = res?.authorities ?? [];
    if (auth.length && auth[0]?.address) return String(auth[0].address);
  } catch {
    /* DAS может быть недоступен на бесплатном тарифе */
  }
  try {
    const info = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
    const parsed = info?.value?.data?.parsed?.info;
    return parsed?.mintAuthority ?? null;
  } catch {
    return null;
  }
}

const labelCache = new Map<string, { labels: string[]; at: number }>();

function cachedLabels(pool: string, wallet: string): string[] | null {
  const key = `${pool}:${wallet}`;
  const hit = labelCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.labels;
  const row = db
    .prepare(`SELECT labels FROM wallet_labels WHERE pool = ? AND wallet = ?`)
    .get(pool, wallet) as any;
  if (row) return JSON.parse(row.labels);
  return null;
}

export function storeLabels(pool: string, wallet: string, labels: string[]) {
  labelCache.set(`${pool}:${wallet}`, { labels, at: Date.now() });
  db.prepare(
    `INSERT INTO wallet_labels (pool, wallet, labels, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(pool, wallet) DO UPDATE SET labels = excluded.labels, updated_at = excluded.updated_at`,
  ).run(pool, wallet, JSON.stringify(labels), Date.now());
}

type ParsedTx = {
  slot: number;
  ts: number;
  signer: string;
  tokenDelta: number;
  quoteDelta: number;
  ok: boolean;
};

async function parseSwap(sig: string, blockTime: number, mint: string, quoteMint: string): Promise<ParsedTx | null> {
  try {
    const tx = await rpc("getTransaction", [
      sig,
      { maxSupportedTransactionVersion: 1, encoding: "jsonParsed", commitment: "confirmed" },
    ]);
    if (!tx || tx.meta?.err) return null;
    const keys = tx.transaction?.message?.accountKeys ?? [];
    const signer = typeof keys[0] === "string" ? keys[0] : keys[0]?.pubkey;
    if (!signer) return null;

    const sumFor = (arr: any[], owner: string, m: string) =>
      (arr ?? [])
        .filter((b: any) => b.owner === owner && b.mint === m)
        .reduce((s: number, b: any) => s + Number(b.uiTokenAmount?.uiAmount ?? 0), 0);

    const pre = tx.meta?.preTokenBalances ?? [];
    const post = tx.meta?.postTokenBalances ?? [];
    const tokenDelta = sumFor(post, signer, mint) - sumFor(pre, signer, mint);
    const quoteTokenDelta = sumFor(post, signer, quoteMint) - sumFor(pre, signer, quoteMint);

    const idx = (tx.transaction?.message?.accountKeys ?? []).findIndex(
      (k: any) => (typeof k === "string" ? k : k.pubkey) === signer,
    );
    const preSol = tx.meta?.preBalances?.[idx] ?? 0;
    const postSol = tx.meta?.postBalances?.[idx] ?? 0;
    const solDelta = (postSol - preSol) / 1e9;

    // Для SOL-пары считаем по lamports (комиссии сети дают погрешность ~0.000005 SOL),
    // для стейблкоин-пары — по токен-балансу котируемого актива.
    const quoteDelta = quoteMint === WSOL ? solDelta : quoteTokenDelta;
    if (!tokenDelta || !quoteDelta) return null;
    if (Math.sign(tokenDelta) === Math.sign(quoteDelta)) return null; // это не своп (ликвидность/клейм)

    return {
      slot: Number(tx.slot ?? 0),
      ts: Number(tx.blockTime ?? blockTime ?? Math.floor(Date.now() / 1000)),
      signer,
      tokenDelta,
      quoteDelta,
      ok: true,
    };
  } catch {
    return null;
  }
}

/** Ранние покупатели: снайперы (≤60с), инсайдеры (≤10мин), бандлы (≥3 кошелька в одном слоте). */
async function scanEarly(ctx: WatchCtx) {
  if (ctx.earlyDone && Date.now() - ctx.lastUsed < 3600_000) return;
  ctx.earlyDone = true;

  // результат храним навсегда: повторный обход истории пула не нужен
  const done = db.prepare(`SELECT parsed, reliable FROM pool_early WHERE pool = ?`).get(ctx.pool) as any;
  if (done) {
    ctx.earlyReliable = !!done.reliable;
    return;
  }
  const windowEnd = ctx.createdAt + 600; // 10 минут

  const collected: { sig: string; slot: number; ts: number }[] = [];
  let before: string | undefined;
  let reachedStart = false;

  for (let page = 0; page < 4; page++) {
    try {
      const params: any = { limit: 1000 };
      if (before) params.before = before;
      const sigs: any[] = await rpc("getSignaturesForAddress", [ctx.pool, params]);
      if (!sigs.length) {
        reachedStart = true;
        break;
      }
      for (const s of sigs) {
        const ts = s.blockTime ?? 0;
        if (ts && ts <= windowEnd && !s.err) collected.push({ sig: s.signature, slot: s.slot, ts });
      }
      const oldest = sigs[sigs.length - 1];
      before = oldest.signature;
      if (oldest.blockTime && oldest.blockTime <= ctx.createdAt + 5) {
        reachedStart = true;
        break;
      }
      if (sigs.length < 1000) {
        reachedStart = true;
        break;
      }
    } catch {
      break;
    }
  }

  ctx.earlyReliable = reachedStart;
  if (!collected.length) return;

  // Снайперы: первая минута. Инсайдеры: первые 10 минут.
  const early = collected.slice(-10);
  const bySlot = new Map<number, Set<string>>();
  let parsed = 0;

  for (const item of early) {
    if (parsed >= 5) break;
    const p = await parseSwap(item.sig, item.ts, ctx.mint, ctx.quoteMint);
    if (!p) continue;
    parsed++;
    const labels: string[] = [];
    const after = item.ts - ctx.createdAt;
    if (after <= 60) labels.push("sniper");
    else if (after <= 600) labels.push("insider");
    if (ctx.creator && p.signer === ctx.creator) labels.push("creator");
    if (!bySlot.has(item.slot)) bySlot.set(item.slot, new Set());
    bySlot.get(item.slot)!.add(p.signer);
    storeLabels(ctx.pool, p.signer, labels);
  }

  // Бандл: несколько разных кошельков в одном слоте
  for (const [, wallets] of bySlot) {
    if (wallets.size >= 3) {
      for (const w of wallets) {
        const cur = cachedLabels(ctx.pool, w) ?? [];
        storeLabels(ctx.pool, w, [...new Set([...cur, "bundler"])]);
      }
    }
  }
  db.prepare(
    `INSERT INTO pool_early (pool, done_at, reliable, parsed) VALUES (?,?,?,?)
     ON CONFLICT(pool) DO UPDATE SET done_at = excluded.done_at, reliable = excluded.reliable, parsed = excluded.parsed`,
  ).run(ctx.pool, Date.now(), reachedStart ? 1 : 0, parsed);
  journal(
    "WS",
    `ранние покупатели ${short(ctx.pool)}: найдено ${collected.length}, разобрано ${parsed}, до старта пула ${reachedStart ? "дошли" : "не дошли"}`,
  );
}

export class SwapWatcher {
  private ctxs = new Map<string, WatchCtx>();
  private timer: NodeJS.Timeout | null = null;
  feed: SwapRow[] = [];
  private inflight = 0;
  private queue: { ctx: WatchCtx; sig: string }[] = [];
  private budget = 4;
  private budgetAt = Date.now();
  private pausedUntil = 0;
  counters = {
    queued: 0, parsed: 0, nullParse: 0, err429: 0, saved: 0,
    ws: 0, wsErr: 0, wsNoDlmm: 0, wsEnq: 0,
    enqSeen: 0, enqDecoded: 0, enqQueued: 0, enqZero: 0,
  };
  private queued = new Set<string>();
  private draining = false;
  /** Цены из потока свапов: pool → { price (quote per token), at } */
  prices = new Map<string, { price: number; at: number }>();
  /** Колбэк для мгновенной реакции движка на сделку */
  onSwap: ((pool: string) => void) | null = null;

  start(intervalMs = 5000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  watch(input: {
    pool: string;
    mint: string;
    quoteMint: string;
    mintDecimals?: number;
    quoteDecimals?: number;
    tokenIsX?: boolean;
    quoteUsd: number;
    createdAt: number;
    creator: string | null;
  }) {
    const existing = this.ctxs.get(input.pool);
    if (existing) {
      existing.lastUsed = Date.now();
      existing.quoteUsd = input.quoteUsd || existing.quoteUsd;
      return existing;
    }
    const tokenIsX = input.tokenIsX ?? true;
    const ctx: WatchCtx = {
      ...input,
      tokenIsX,
      decX: tokenIsX ? input.mintDecimals ?? 9 : input.quoteDecimals ?? 9,
      decY: tokenIsX ? input.quoteDecimals ?? 9 : input.mintDecimals ?? 9,
      mintDecimals: input.mintDecimals ?? 9,
      quoteDecimals: input.quoteDecimals ?? 9,
      lastSig: null,
      seen: new Set(),
      earlyDone: false,
      earlyReliable: false,
      lastUsed: Date.now(),
      busy: false,
    };
    this.ctxs.set(input.pool, ctx);
    this.attachStream(ctx);
    void scanEarly(ctx);
    return ctx;
  }

  private sweepAt = new Map<string, number>();

  /** Догоняем реальные свапы по подписи (триггер — WS-событие, разбор — RPC). */
  private triggerSweep(ctx: WatchCtx, minGap = 800) {
    const last = this.sweepAt.get(ctx.pool) ?? 0;
    if (Date.now() - last < minGap) return;
    this.sweepAt.set(ctx.pool, Date.now());
    void (async () => {
      try {
        const sigs: any[] = await rpc("getSignaturesForAddress", [ctx.pool, { limit: 5 }]);
        for (const s of sigs.filter((x) => !x.err && !ctx.seen.has(x.signature)).reverse().slice(-3)) {
          ctx.seen.add(s.signature);
          if (ctx.seen.size > 5000) ctx.seen.clear();
          const parsed = await parseSwap(s.signature, s.blockTime ?? 0, ctx.mint, ctx.quoteMint);
          if (parsed) this.saveRow(ctx, s.signature, parsed);
        }
      } catch {
        /* пропускаем такт */
      }
    })();
  }

  private attachStream(ctx: WatchCtx) {
    const key = `logs:${ctx.pool}`;
    solanaStream.subscribe(
      key,
      "logsSubscribe",
      [{ mentions: [ctx.pool] }, { commitment: "confirmed" }],
      (value) => {
        this.counters.ws++;
        const sig = value?.signature;
        if (!sig || value?.err) {
          this.counters.wsErr++;
          return;
        }
        const logs: string[] = value?.logs ?? [];
        // отсекаем транзакции, где нашего пула касаются, но DLMM не вызывается
        if (!logs.some((l) => l.includes(DLMM_PROGRAM))) {
          this.counters.wsNoDlmm++;
          return;
        }
        this.counters.wsEnq++;
        this.triggerSweep(ctx);
      },
    );

    // изменение аккаунта пула = прошёл своп или изменилась ликвидность → обновляем цену
    solanaStream.subscribe(
      `acct:${ctx.pool}`,
      "accountSubscribe",
      [ctx.pool, { commitment: "confirmed", encoding: "base64" }],
      () => {
        const now = Date.now();
        // аккаунт пула меняется только когда в нём реально прошёл своп/ликвидность
        if (now - (ctx.lastAccountAt ?? 0) < 800) return;
        ctx.lastAccountAt = now;
        void (async () => {
          try {
            const pool = await fetchPool(ctx.pool);
            if (pool && pool.currentPrice > 0) {
              this.prices.set(ctx.pool, { price: pool.currentPrice, at: Date.now() });
              this.onSwap?.(ctx.pool);
            }
          } catch {
            /* цена обновится следующим событием */
          }
          this.triggerSweep(ctx, 700);
        })();
      },
    );
    journal("WS", `подписка на пул ${short(ctx.pool)}`);
  }

  private enqueue(ctx: WatchCtx, sig: string, logs: string[] = []) {
    if (ctx.seen.has(sig) || this.queued.has(sig)) {
      this.counters.enqSeen++;
      return;
    }

    // 1) бесплатный путь: разбираем событие прямо из логов
    try {
      const ev = decodeSwapFromLogs(logs, ctx.pool);
      if (ev && ev.lbPair === ctx.pool) {
        this.counters.enqDecoded++;
        ctx.seen.add(sig);
        this.applyEvent(ctx, sig, ev);
        return;
      }
    } catch {
      /* переходим к RPC-разбору */
    }

    // 2) fallback: тянем транзакцию (с ограничением частоты)
    this.queued.add(sig);
    this.counters.enqQueued++;
    this.queue.push({ ctx, sig });
    if (this.queue.length > 40) this.queue.splice(0, this.queue.length - 40);
    void this.drain();
  }

  /** Сделка из логов: без RPC, задержка ~0.5 с. */
  private applyEvent(ctx: WatchCtx, sig: string, ev: ReturnType<typeof decodeSwapFromLogs> & object) {
    const inUi = Number(ev.amountIn) / 10 ** ctx.decX;
    const outUi = Number(ev.amountOut) / 10 ** ctx.decY;
    // swap_for_y = X→Y. Если наш токен это X — значит продажа токена, иначе покупка.
    const selling = ctx.tokenIsX ? ev.swapForY : !ev.swapForY;
    const tokenAmount = selling ? inUi : outUi;
    const quoteAmount = selling ? outUi : inUi;
    if (!tokenAmount || !quoteAmount) return;

    const parsed: ParsedTx = {
      slot: 0,
      ts: Math.floor(Date.now() / 1000),
      signer: ev.from,
      tokenDelta: selling ? -tokenAmount : tokenAmount,
      quoteDelta: selling ? quoteAmount : -quoteAmount,
      ok: true,
    };
    this.saveRow(ctx, sig, parsed, {
      tokenAmount,
      quoteAmount,
      side: selling ? "sell" : "buy",
      fromEvent: true,
    });
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      const workers = Array.from({ length: 2 }, async () => {
        while (this.queue.length) {
          // бюджет: не больше ~4 разборов в секунду (бесплатный тариф ~10 rps на всё)
          const now = Date.now();
          if (now - this.budgetAt > 1000) {
            this.budget = 4;
            this.budgetAt = now;
          }
          if (now < this.pausedUntil || this.budget <= 0) {
            await new Promise((r) => setTimeout(r, 220));
            continue;
          }
          const item = this.queue.shift();
          if (!item) break;
          this.queued.delete(item.sig);
          const { ctx, sig } = item;
          if (ctx.seen.has(sig)) continue;
          if (ctx.seen.size > 5000) ctx.seen.clear();
          ctx.seen.add(sig);
          this.budget--;
          this.counters.queued++;
          let parsed = null;
          try {
            parsed = await parseSwap(sig, 0, ctx.mint, ctx.quoteMint);
          } catch (err: any) {
            const msg = String(err?.message ?? err);
            if (msg.includes("429")) this.counters.err429++;
            if (msg.includes("429")) this.pausedUntil = Date.now() + 3000;
          }
          if (!parsed) {
            this.counters.nullParse++;
            continue;
          }
          this.counters.parsed++;
          this.saveRow(ctx, sig, parsed);
        }
      });
      await Promise.all(workers);
    } finally {
      this.draining = false;
    }
  }

  private saveRow(
    ctx: WatchCtx,
    sig: string,
    p: ParsedTx,
    pre?: { tokenAmount: number; quoteAmount: number; side: "buy" | "sell"; fromEvent: boolean },
  ) {
    const tokenAmount = pre?.tokenAmount ?? Math.abs(p.tokenDelta);
    const quoteAmount = pre?.quoteAmount ?? Math.abs(p.quoteDelta);
    const side = pre?.side ?? (p.tokenDelta > 0 ? "buy" : "sell");
    if (!tokenAmount || !quoteAmount) return;

    // ── санитарные проверки, чтобы в ленту не попадал мусор:
    const valueUsd = quoteAmount * ctx.quoteUsd;
    if (valueUsd < 0.5) return; // пыль и «комиссия сети вместо сделки»
    const priceQuote = quoteAmount / tokenAmount;
    const ref = this.prices.get(ctx.pool)?.price ?? ctx.lastPriceQuote;
    if (ref && Number.isFinite(ref) && ref > 0) {
      // сделка нашего пула не может быть в 2 раза дешевле/дороже текущей цены
      if (Math.abs(Math.log(priceQuote / ref)) > Math.log(2)) return;
    }
    if (!tokenAmount || !quoteAmount) return;
    const labels = this.labels(ctx, p.signer, valueUsd);
    const row: SwapRow = {
      pool: ctx.pool,
      sig,
      slot: p.slot,
      ts: p.ts || Math.floor(Date.now() / 1000),
      wallet: p.signer,
      side,
      tokenAmount,
      quoteAmount,
      priceQuote,
      priceUsd: priceQuote * ctx.quoteUsd,
      valueUsd: quoteAmount * ctx.quoteUsd,
      labels,
    };
    try {
      db.prepare(
        `INSERT OR IGNORE INTO swaps (pool, sig, slot, ts, wallet, side, token_amount, quote_amount, price_quote, price_usd, value_usd, labels)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        row.pool,
        row.sig,
        row.slot,
        row.ts,
        row.wallet,
        row.side,
        row.tokenAmount,
        row.quoteAmount,
        row.priceQuote,
        row.priceUsd,
        row.valueUsd,
        JSON.stringify(row.labels),
      );
    } catch {
      /* дубликаты игнорируем */
    }
    this.prices.set(ctx.pool, { price: priceQuote, at: Date.now() });
    this.feed = [row, ...this.feed].slice(0, 300);
    try {
      this.onSwap?.(ctx.pool);
    } catch {
      /* ignore */
    }
  }

  /** Свежая цена из потока (если событие было недавно). */
  priceFor(pool: string, maxAgeMs = 20_000): number | null {
    const hit = this.prices.get(pool);
    if (!hit) return null;
    return Date.now() - hit.at <= maxAgeMs ? hit.price : null;
  }

  stats() {
    return { ...this.counters, queue: this.queue.length, budget: this.budget, paused: this.pausedUntil > Date.now() };
  }

  get(pool: string) {
    const ctx = this.ctxs.get(pool);
    if (ctx) ctx.lastUsed = Date.now();
    return ctx ?? null;
  }

  list() {
    return [...this.ctxs.values()].map((c) => ({ pool: c.pool, earlyReliable: c.earlyReliable }));
  }

  private async tick() {
    if (this.inflight > 0) return;
    this.inflight++;
    try {
      const now = Date.now();
      for (const [pool, ctx] of this.ctxs) {
        if (now - ctx.lastUsed > 20 * 60_000) {
          this.ctxs.delete(pool);
          continue;
        }
        if (ctx.busy) continue;
        ctx.busy = true;
        try {
          // Поллинг — только аварийный режим: пока WebSocket жив, данные идут событиями.
          if (!solanaStream.connected) await this.pollPool(ctx);
        } catch {
          /* следующий тик */
        } finally {
          ctx.busy = false;
        }
      }
    } finally {
      this.inflight--;
    }
  }

  private async pollPool(ctx: WatchCtx) {
    const params: any = { limit: 30 };
    if (ctx.lastSig) params.until = ctx.lastSig;
    const sigs: any[] = await rpc("getSignaturesForAddress", [ctx.pool, params]);
    if (!sigs.length) return;
    ctx.lastSig = ctx.lastSig ?? sigs[0].signature;

    const fresh = sigs.filter((s) => !s.err && !ctx.seen.has(s.signature)).reverse();
    if (ctx.seen.size > 4000) ctx.seen.clear();
    for (const s of fresh.slice(-10)) {
      ctx.seen.add(s.signature);
      const parsed = await parseSwap(s.signature, s.blockTime ?? 0, ctx.mint, ctx.quoteMint);
      if (!parsed) continue;
      this.saveRow(ctx, s.signature, parsed);
    }
  }

  private labels(ctx: WatchCtx, wallet: string, valueUsd: number): string[] {
    const labels = new Set<string>(cachedLabels(ctx.pool, wallet) ?? []);
    if (ctx.creator && wallet === ctx.creator) labels.add("creator");
    if (valueUsd >= Number(process.env.WHALE_USD ?? 400)) labels.add("whale");
    const inf = influencerMap();
    if (inf[wallet]) labels.add("influencer");
    const arr = [...labels];
    if (arr.length) storeLabels(ctx.pool, wallet, arr);
    return arr;
  }
}

let influencers: Record<string, string> | null = null;
function influencerMap(): Record<string, string> {
  if (influencers) return influencers;
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const file = path.join(env.root, "data", "influencers.json");
    influencers = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  } catch {
    influencers = {};
  }
  return influencers ?? {};
}

export function swapsFor(pool: string, opts: { limit?: number; side?: string; label?: string } = {}) {
  const limit = Math.min(500, opts.limit ?? 120);
  const where = [`pool = ?`];
  const args: any[] = [pool];
  if (opts.side === "buy" || opts.side === "sell") {
    where.push(`side = ?`);
    args.push(opts.side);
  }
  if (opts.label) {
    where.push(`labels LIKE ?`);
    args.push(`%"${opts.label}"%`);
  }
  args.push(limit);
  const rows = db
    .prepare(`SELECT * FROM swaps WHERE ${where.join(" AND ")} ORDER BY ts DESC, slot DESC LIMIT ?`)
    .all(...args) as any[];

  const stats = db
    .prepare(
      `SELECT side, COUNT(*) AS n, SUM(value_usd) AS v, COUNT(DISTINCT wallet) AS w FROM swaps WHERE pool = ? GROUP BY side`,
    )
    .all(pool) as any[];
  const whales = db
    .prepare(`SELECT COUNT(*) AS n FROM swaps WHERE pool = ? AND labels LIKE '%"whale"%'`)
    .get(pool) as any;

  return {
    swaps: rows.map((r) => ({
      sig: r.sig,
      slot: r.slot,
      ts: r.ts,
      wallet: r.wallet,
      side: r.side,
      tokenAmount: r.token_amount,
      quoteAmount: r.quote_amount,
      priceQuote: r.price_quote,
      priceUsd: r.price_usd,
      valueUsd: r.value_usd,
      labels: JSON.parse(r.labels || "[]"),
    })),
    stats: {
      buys: stats.find((s) => s.side === "buy")?.n ?? 0,
      sells: stats.find((s) => s.side === "sell")?.n ?? 0,
      buyVolume: stats.find((s) => s.side === "buy")?.v ?? 0,
      sellVolume: stats.find((s) => s.side === "sell")?.v ?? 0,
      wallets: Math.max(...stats.map((s) => s.w ?? 0), 0),
      whales: whales?.n ?? 0,
    },
  };
}
