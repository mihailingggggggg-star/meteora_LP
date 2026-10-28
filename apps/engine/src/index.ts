import { engine, swapWatcher } from "./engine.js";
import { startServer } from "./server.js";
import { journal, rotateJournals } from "./journal.js";
import * as live from "./executor.js";
import { alertCritical } from "./alerts.js";
import { env } from "./env.js";

rotateJournals();
startServer();
swapWatcher.start(5000);

let ticking = false;
setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    await engine.tick();
  } catch (err: any) {
    journal("ERROR", `tick: ${err?.message ?? err}`);
  } finally {
    ticking = false;
  }
}, 5000);

setInterval(() => {
  engine.snapshotEquityNow();
}, 60_000);

// live: капитал берём с кошелька (при старте и раз в 10 минут, пока нет открытых позиций)
setTimeout(() => void engine.syncLiveCapital(true), 4000);
setInterval(() => void engine.syncLiveCapital(), 10 * 60_000);

// ── боевой контур: сверка базы с цепочкой.
// Если позиция «есть в базе, но нет в пуле» (или наоборот) — останавливаемся:
// управлять фантомом опаснее, чем пропустить сделку.
const ready = live.readiness();
if (env.mode === "live" || live.armed()) {
  if (ready.ok) journal("BOOT", `live-контур готов: кошелёк ${live.walletAddress()}, лимит $${env.live.maxPositionUsd}/позиция`);
  else journal("WARN", `live-контур не активен: ${ready.reasons.join("; ")}`);
}

setInterval(async () => {
  if (!live.armed()) return;
  try {
    const r = await live.reconcile();
    if (!r.ok) {
      engine.halted = true;
      engine.haltReason = "расхождение с цепочкой";
      journal("HALT", `сверка с цепочкой: расхождение`, r);
      await alertCritical(
        `Расхождение базы и цепочки: в базе ${r.dbOpen} позиций, в цепочке ${r.chainPositions}.` +
          (r.missing.length ? `\nНет в цепочке: ${r.missing.join(", ")}` : "") +
          (r.notes.length ? `\n${r.notes.join("; ")}` : "") +
          `\nТорговля остановлена.`,
      );
    }
  } catch (err: any) {
    journal("ERROR", `сверка с цепочкой: ${err?.message ?? err}`);
  }
}, Math.max(1, env.live.reconcileMinutes) * 60_000);

async function loop() {
  if (engine.running && !engine.halted) {
    try {
      await engine.scan();
    } catch (err: any) {
      journal("ERROR", `scan loop: ${err?.message ?? err}`);
    }
  }
  setTimeout(loop, Math.max(15, engine.settings.scanIntervalSeconds) * 1000);
}

setTimeout(() => {
  void loop();
}, 2500);

process.on("SIGINT", () => {
  swapWatcher.stop();
  process.exit(0);
});

console.log("[engine] started");
