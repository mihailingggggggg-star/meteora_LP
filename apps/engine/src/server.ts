import http from "node:http";
import { URL } from "node:url";
import { engine, swapWatcher } from "./engine.js";
import { swapsFor } from "./swaps.js";
import { solanaStream } from "./stream.js";
import { db } from "./db.js";
import { journal, readJournal } from "./journal.js";
import { event } from "./db.js";
import { env } from "./env.js";

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(data);
};

const readBody = async (req: http.IncomingMessage): Promise<any> => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
};

function rangeBounds(params: URLSearchParams) {
  const range = params.get("range") ?? "today";
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (range === "custom") {
    const from = Number(params.get("from") ?? startOfToday.getTime());
    const to = Number(params.get("to") ?? Date.now());
    return { from, to, label: "custom" };
  }
  const day = 86_400_000;
  if (range === "today") return { from: startOfToday.getTime(), to: Date.now(), label: range };
  if (range === "yesterday")
    return { from: startOfToday.getTime() - day, to: startOfToday.getTime(), label: range };
  if (range === "7d") return { from: Date.now() - 7 * day, to: Date.now(), label: range };
  if (range === "30d") return { from: Date.now() - 30 * day, to: Date.now(), label: range };
  return { from: Date.now() - 7 * day, to: Date.now(), label: range };
}

function analytics(params: URLSearchParams) {
  const { from, to, label } = rangeBounds(params);
  const mode = params.get("mode") ?? engine.mode;

  const closed = db
    .prepare(
      `SELECT * FROM positions WHERE mode=? AND status='closed' AND closed_at BETWEEN ? AND ? ORDER BY closed_at DESC`,
    )
    .all(mode, from, to) as any[];

  const pnl = closed.reduce((s, p) => s + (p.pnl_usd ?? 0), 0);
  const fees = closed.reduce((s, p) => s + (p.fees_usd ?? 0), 0);
  const wins = closed.filter((p) => (p.pnl_usd ?? 0) > 0);
  const losses = closed.filter((p) => (p.pnl_usd ?? 0) <= 0);
  const lossPnl = losses.reduce((s, p) => s + (p.pnl_usd ?? 0), 0);

  const byToken = new Map<string, { symbol: string; pnl: number; trades: number; fees: number }>();
  for (const p of closed) {
    const key = p.token_symbol ?? p.pool_name;
    const cur = byToken.get(key) ?? { symbol: key, pnl: 0, trades: 0, fees: 0 };
    cur.pnl += p.pnl_usd ?? 0;
    cur.fees += p.fees_usd ?? 0;
    cur.trades += 1;
    byToken.set(key, cur);
  }
  const tokens = [...byToken.values()].sort((a, b) => b.pnl - a.pnl);

  const equity = db
    .prepare(`SELECT ts, equity, cash, in_positions FROM equity WHERE mode=? AND ts BETWEEN ? AND ? ORDER BY ts`)
    .all(mode, from, to) as any[];

  const byDay = new Map<string, { day: string; pnl: number; fees: number; trades: number }>();
  for (const p of closed) {
    const d = new Date(p.closed_at ?? Date.now());
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const cur = byDay.get(key) ?? { day: key, pnl: 0, fees: 0, trades: 0 };
    cur.pnl += p.pnl_usd ?? 0;
    cur.fees += p.fees_usd ?? 0;
    cur.trades += 1;
    byDay.set(key, cur);
  }

  // причины выхода и ребалансы
  const byReasonMap = new Map<string, { reason: string; n: number; pnl: number; rebalances: number }>();
  for (const p of closed) {
    const key = p.exit_reason ?? "—";
    const cur = byReasonMap.get(key) ?? { reason: key, n: 0, pnl: 0, rebalances: 0 };
    cur.n += 1;
    cur.pnl += p.pnl_usd ?? 0;
    cur.rebalances += p.rebalances ?? 0;
    byReasonMap.set(key, cur);
  }
  const rebalancesTotal = closed.reduce((s, p) => s + (p.rebalances ?? 0), 0);
  const holdHours =
    closed.length > 0
      ? closed.reduce((s, p) => s + ((p.closed_at ?? 0) - (p.opened_at ?? 0)) / 3600_000, 0) / closed.length
      : 0;
  const frictionTotal = closed.reduce((s, p) => s + (p.friction_usd ?? 0), 0);

  const days = Math.max(1, (to - from) / 86_400_000);
  const avgDaily = pnl / days;
  const state = engine.getEquity();
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysLeft = Math.max(0, Math.ceil((endOfMonth.getTime() - now.getTime()) / 86_400_000));
  const forecast = state.equity + avgDaily * daysLeft;

  return {
    range: label,
    from,
    to,
    pnl,
    pnlPct: (pnl / Math.max(1, engine.deposit)) * 100,
    fees,
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    lossPnl,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    avgDaily,
    bestToken: tokens[0] ?? null,
    worstToken: tokens[tokens.length - 1] ?? null,
    tokens: tokens.slice(0, 10),
    byReason: [...byReasonMap.values()].sort((a, b) => b.n - a.n),
    rebalances: rebalancesTotal,
    avgHoldHours: holdHours,
    friction: frictionTotal,
    equitySeries: equity.map((e) => ({ ts: e.ts, equity: e.equity })),
    daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    positions: closed.slice(0, 60).map((p) => ({
      id: p.id,
      pool: p.pool,
      poolName: p.pool_name,
      tokenSymbol: p.token_symbol,
      pnl: p.pnl_usd,
      pnlPct: p.pnl_pct,
      fees: p.fees_usd,
      reason: p.exit_reason,
      openedAt: p.opened_at,
      closedAt: p.closed_at,
      capital: p.capital,
      predicted: p.predicted_15h,
    })),
    forecast: {
      endOfMonth: forecast,
      daysLeft,
      avgDaily,
      deposit: engine.deposit,
      equity: state.equity,
    },
  };
}

function positionsList(params: URLSearchParams) {
  const status = params.get("status");
  const mode = params.get("mode") ?? engine.mode;
  const limit = Number(params.get("limit") ?? 100);
  const where = [`mode = ?`];
  const args: any[] = [mode];
  if (status && status !== "all") {
    where.push(`status = ?`);
    args.push(status);
  }
  args.push(limit);
  const rows = db
    .prepare(`SELECT * FROM positions WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`)
    .all(...args) as any[];
  return rows.map((r) => {
    const isOpen = r.status === "open";
    const open = isOpen ? engine.positionDto(engine.positions.find((p) => p.id === r.id) as any) : null;
    return {
      id: r.id,
      pool: r.pool,
      poolName: r.pool_name,
      tokenSymbol: r.token_symbol,
      tokenMint: r.token_mint,
      status: r.status,
      capital: r.capital,
      entryPrice: r.entry_price,
      lastPrice: open?.id === r.id ? open.lastPrice : r.last_price,
      pAvgPrice: r.entry_price * (r.p_avg ?? 1),
      pExitPrice: r.entry_price * (r.p_exit ?? 0.95),
      fees: r.fees_usd ?? 0,
      claimed: r.claimed_usd ?? 0,
      pnl: open?.id === r.id ? open.pnl : (r.pnl_usd ?? 0),
      pnlPct: open?.id === r.id ? open.pnlPctOfDeposit : (r.pnl_pct ?? 0),
      exitReason: r.exit_reason,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
      predicted15h: r.predicted_15h,
      feePct: (r.fee_pct ?? 0) * 100,
      vol24: r.vol24,
      tR: r.t_r,
      rShare: r.r_share,
      rangePct: open?.id === r.id ? open.rangePct : (r.range_pct ?? 0),
      atrPct: open?.id === r.id ? open.atrPct : (r.atr_pct ?? 0),
      turnover24: r.turnover24 ?? 0,
      rebalances: r.rebalances ?? 0,
      consecutiveLosses: r.consecutive_losses ?? 0,
      consecutiveLossStop: engine.settings.consecutiveLossStop,
      maxRebalances: engine.settings.maxRebalancesPerDay,
      solPct: open?.id === r.id ? open.solPct : 50,
      tokenPct: open?.id === r.id ? open.tokenPct : 50,
      value: open?.id === r.id ? open.value : (r.capital ?? 0),
      zones: r.zones ? JSON.parse(r.zones) : null,
      timeInTradeHours: ((r.closed_at ?? Date.now()) - r.opened_at) / 3600_000,
    };
  });
}

function positionDetail(id: number) {
  const r = db.prepare(`SELECT * FROM positions WHERE id = ?`).get(id) as any;
  if (!r) return null;
  const events = db
    .prepare(`SELECT ts, type, payload FROM position_events WHERE position_id = ? ORDER BY ts DESC LIMIT 200`)
    .all(id) as any[];
  const live = engine.positions.find((p) => p.id === id);
  const open = live ? engine.positionDto(live) : null;
  const alloc = db
    .prepare(`SELECT ts, sol_usd, token_usd, price FROM pos_alloc WHERE position_id = ? ORDER BY ts`)
    .all(id) as any[];
  return {
    allocation: alloc.map((a) => ({ ts: a.ts, sol: a.sol_usd, token: a.token_usd, price: a.price })),
    ...r,
    zones: r.zones ? JSON.parse(r.zones) : null,
    bins: r.bins ? JSON.parse(r.bins) : [],
    live: open, allocationLive: open ? undefined : undefined,
    events: events.map((e) => ({ ts: e.ts, type: e.type, payload: e.payload ? JSON.parse(e.payload) : null })),
  };
}

export function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${env.port}`);
    const p = url.pathname;
    const q = url.searchParams;

    if (req.method === "OPTIONS") return json(res, 204, {});

    try {
      if (p === "/api/health") return json(res, 200, { ok: true, mode: engine.mode, ts: Date.now() });
      if (p === "/api/state") return json(res, 200, engine.state());
      if (p === "/api/candidates") {
        if (engine.candidates.length) {
          return json(res, 200, { candidates: engine.candidates, lastScanAt: engine.lastScanAt, scanning: engine.scanning });
        }
        // после рестарта показываем последний скан из БД в том же формате, что и живой DTO
        const rows = db
          .prepare(`SELECT * FROM candidates WHERE ts > ? ORDER BY ts DESC, score DESC LIMIT 24`)
          .all(Date.now() - 6 * 3600_000) as any[];
        const seen = new Set<string>();
        const candidates = rows
          .filter((r) => (seen.has(r.pool) ? false : (seen.add(r.pool), true)))
          .slice(0, 10)
          .map((r) => {
            let payload: any = {};
            try {
              payload = JSON.parse(r.payload || "{}");
            } catch {}
            return {
              pool: r.pool,
              poolName: r.pool_name,
              tokenSymbol: String(r.pool_name ?? "").split("-")[0],
              tokenMint: "",
              score: r.r15 ?? r.score,
              rDay: r.rday ?? r.score,
              r15h: r.r15 ?? r.score,
              atrPct: +(payload.atr ?? 0).toFixed(2),
              turnover24: +(payload.turnover ?? 0).toFixed(1),
              turnover1h: 0,
              rangePct: +((payload.rangePct ?? 0.025) * 100).toFixed(2),
              concentration: payload.concentration ?? 0,
              tR: Math.round(r.t_r ?? 0),
              activeTvl: Math.round(payload.activeTvl ?? 0),
              capital: Math.round(r.capital ?? 0),
              feePct: +(r.fee_pct ?? 0),
              vol24: Math.round(r.vol24 ?? 0),
              vol1h: 0,
              tvl: 0,
              inRangeShare: payload.inRangeShare ?? 0,
              worstLossPct: +(((payload.rangePct ?? 0.025) + 0.0015) * 100).toFixed(2),
              expectedFees15h: 0,
              holders: 0,
              poolFees24: 0,
              poolFees1h: 0,
              ourSharePct: +(
                ((r.capital ?? 0) / ((r.t_r ?? 0) + (r.capital ?? 0) || 1)) * 100
              ).toFixed(2),
              ourHourly: +((((r.rday ?? 0) / 100) * (r.capital ?? 0)) / 24).toFixed(3),
              source: "db",
              notes: r.reason ? [r.reason] : [],
              ts: r.ts,
            };
          });
        return json(res, 200, { candidates, lastScanAt: engine.lastScanAt, scanning: engine.scanning, stale: true });
      }
      if (p === "/api/positions") return json(res, 200, { positions: positionsList(q) });
      const posMatch = p.match(/^\/api\/positions\/(\d+)$/);
      if (posMatch) {
        const d = positionDetail(Number(posMatch[1]));
        return json(res, d ? 200 : 404, d ?? { error: "not found" });
      }
      const chartMatch = p.match(/^\/api\/positions\/(\d+)\/chart$/);
      if (chartMatch) {
        const r = db.prepare(`SELECT pool FROM positions WHERE id = ?`).get(Number(chartMatch[1])) as any;
        if (!r) return json(res, 404, { error: "not found" });
        const data = await engine.chart(r.pool, q.get("tf") ?? "5m");
        return json(res, 200, data);
      }
      const poolChart = p.match(/^\/api\/pools\/([A-Za-z0-9]+)\/chart$/);
      if (poolChart) {
        const data = await engine.chart(poolChart[1], q.get("tf") ?? "5m");
        return json(res, 200, data);
      }
      if (p === "/api/swaps") {
        const pool = q.get("pool");
        if (!pool) return json(res, 400, { error: "pool required" });
        if (!swapWatcher.get(pool)) void engine.ensureWatch(pool);
        return json(res, 200, {
          ...swapsFor(pool, {
            limit: Number(q.get("limit") ?? 120),
            side: q.get("side") ?? undefined,
            label: q.get("label") ?? undefined,
          }),
          stream: { ...solanaStream.status(), watcher: swapWatcher.stats() },
          streamedPrice: swapWatcher.priceFor(pool, 60_000),
        });
      }
      if (p === "/api/stream/status") return json(res, 200, solanaStream.status());
      if (p === "/api/swaps/pools") {
        const pos = engine.positionDto();
        const out: any[] = [];
        if (pos) out.push({ address: pos.pool, name: pos.poolName, symbol: pos.tokenSymbol, active: true });
        for (const c of engine.candidates ?? []) {
          if (!out.find((x) => x.address === c.pool)) out.push({ address: c.pool, name: c.poolName, symbol: c.tokenSymbol, active: false });
        }
        // прогреваем наблюдение за активным пулом и парой кандидатов,
        // чтобы вкладка «Свапы» не пустовала при переключении
        for (const item of out.slice(0, 3)) {
          if (!swapWatcher.get(item.address)) void engine.ensureWatch(item.address);
        }
        return json(res, 200, { pools: out.slice(0, 10), watching: swapWatcher.list() });
      }
      if (p === "/api/analytics") return json(res, 200, analytics(q));
      if (p === "/api/journal") {
        const nowD = new Date();
        const localDay = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, "0")}-${String(nowD.getDate()).padStart(2, "0")}`;
        const date = q.get("date") || localDay;
        return json(res, 200, { date, lines: readJournal(date) });
      }
      if (p === "/api/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const send = () => {
          try {
            res.write(`data: ${JSON.stringify(engine.state())}\n\n`);
          } catch {
            /* closed */
          }
        };
        send();
        const timer = setInterval(send, 3000);
        req.on("close", () => clearInterval(timer));
        return;
      }
      if (p.startsWith("/api/bot/") && req.method === "POST") {
        const action = p.split("/").pop();
        if (action === "start") {
          engine.running = true;
          engine.halted = false;
          engine.haltReason = null;
          journal("BOOT", "бот запущен вручную");
        }
        if (action === "stop") {
          engine.running = false;
          journal("WARN", "бот остановлен вручную");
        }
        if (action === "scan") {
          void engine.scan();
        }
        if (action === "enter") {
          const body = await readBody(req);
          const address = String(body?.pool ?? "");
          if (!address) return json(res, 400, { error: "pool required" });
          const out = await engine.enterByAddress(address);
          return json(res, out.ok ? 200 : 409, out);
        }
        if (action === "claim" && engine.positions.length) {
          const body = await readBody(req).catch(() => ({}) as any);
          const wantId = Number(body?.id ?? 0);
          const pos = (wantId ? engine.positions.find((p) => p.id === wantId) : engine.positions[0]) ?? engine.positions[0];
          const claimed = pos.feesAccrued;
          pos.feesClaimed += claimed;
          pos.feesAccrued = 0;
          engine.cash += claimed;
          pos.claimedAt = Date.now();
          db.prepare(`UPDATE positions SET fees_usd = ?, claimed_usd = ? WHERE id = ?`).run(0, pos.feesClaimed, pos.id);
          journal("CLAIM", `pos#${pos.id} ручной сбор комиссий $${claimed.toFixed(2)}`);
          event(pos.id, "CLAIM", { claimed, manual: true });
        }
        if (action === "close") {
          const body = await readBody(req).catch(() => ({}) as any);
          const id = Number(body?.id ?? 0);
          if (id) await engine.closePositionById(id, "MANUAL");
          else if (engine.positions[0]) await engine.closePosition("MANUAL");
        }
        if (action === "reset" && engine.mode === "demo") {
          const open = engine.positions[0];
          if (open) await engine.closePosition("MANUAL", open.lastPrice);
          db.prepare(`DELETE FROM positions WHERE mode='demo'`).run();
          db.prepare(`DELETE FROM equity WHERE mode='demo'`).run();
          db.prepare(`DELETE FROM position_events`).run();
          db.prepare(`DELETE FROM candidates`).run();
          engine.deposit = env.demoDeposit;
          engine.cash = env.demoDeposit;
          engine.halted = false;
          engine.positions = [];
          journal("BOOT", `демо-контур сброшен, депозит $${env.demoDeposit}`);
        }
        return json(res, 200, engine.state());
      }
      if (p === "/api/settings" && req.method === "POST") {
        const body = await readBody(req);
        engine.settings = { ...engine.settings, ...body };
        db.prepare(
          `INSERT INTO settings (key, value) VALUES ('engine.settings', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        ).run(JSON.stringify(engine.settings));
        journal("BOOT", `настройки обновлены: ${Object.keys(body).join(", ")}`);
        return json(res, 200, engine.state());
      }
      return json(res, 404, { error: "not found", path: p });
    } catch (err: any) {
      journal("ERROR", `api ${p}: ${err?.message ?? err}`);
      return json(res, 500, { error: err?.message ?? String(err) });
    }
  });

  server.listen(env.port, "127.0.0.1", () => {
    console.log(`[engine] listening on http://127.0.0.1:${env.port} (mode=${engine.mode})`);
  });
  return server;
}
