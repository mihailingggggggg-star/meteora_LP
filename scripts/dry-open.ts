/**
 * Проверка боевого пути БЕЗ денег: строит вход в реальный пул и прогоняет
 * openPosition в репетиции (LIVE_DRY_RUN=true). Ничего не покупает и не отправляет.
 *
 * Запуск: npx tsx scripts/dry-open.ts [капитал$]
 */
import { env } from "../apps/engine/src/env.js";
import { fetchPools, isSolPair } from "../apps/engine/src/meteora.js";
import { openPosition } from "../apps/engine/src/executor.js";

async function main() {
  if (!env.live.dryRun) {
    console.error("ОПАСНО: LIVE_DRY_RUN выключен — этот скрипт только для репетиции. Выход.");
    process.exit(1);
  }
  const capital = Number(process.argv[2] || 5);
  const pools = await fetchPools(300, "tvl:desc");
  const sol = pools.filter((p) => isSolPair(p) && p.tvl > 50_000 && p.feeTvl24h >= 1 && p.binStep <= 150);
  sol.sort((a, b) => b.feeTvl24h - a.feeTvl24h);
  const pool = sol[0];
  if (!pool) {
    console.log("нет подходящего SOL-пула для теста");
    return;
  }
  const wsol = pool.tokenX.address === env.wsolMint ? pool.tokenX : pool.tokenY;
  console.log(`пул ${pool.name} binStep ${pool.binStep} fee/TVL ${pool.feeTvl24h.toFixed(2)}%/сут TVL $${Math.round(pool.tvl)}`);
  console.log(`капитал $${capital}, SOL $${wsol.price}`);
  try {
    const r = await openPosition({ positionId: 0, pool, capitalUsd: capital, minK: -12, maxK: 12, solPriceUsd: wsol.price });
    console.log("результат:", JSON.stringify(r));
    console.log("OK: путь входа прошёл до отправки (в репетиции транзакция не отправляется)");
  } catch (e: any) {
    console.log("ОШИБКА:", String(e?.message ?? e));
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});