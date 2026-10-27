import { engine, swapWatcher } from "./engine.js";
import { startServer } from "./server.js";
import { journal, rotateJournals } from "./journal.js";

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
