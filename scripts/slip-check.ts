import { fetchPool, splitPair } from "../apps/engine/src/meteora.js";
import { jupiterQuote } from "../apps/engine/src/market.js";
import { env } from "../apps/engine/src/env.js";

async function main() {
  const pools = process.argv.slice(2);
  for (const addr of pools) {
    const pool = await fetchPool(addr);
    if (!pool) { console.log(addr, "нет пула"); continue; }
    const pair = splitPair(pool);
    const usd = Number(process.env.USD || 3);
    const raw = Math.round((usd / pair.token.price) * 10 ** (pair.token.decimals || 9));
    const q = await jupiterQuote(pair.token.address, env.wsolMint, String(raw), 300);
    if (!q) { console.log(pool.name, "нет котировки"); continue; }
    const outUsd = (q.outAmount / 1e9) * pair.solPrice;
    const slip = Math.max(0, (1 - outUsd / usd) * 100);
    console.log(`${pool.name}: продаём $${usd} токена → вернётся $${outUsd.toFixed(3)} → слиппедж ${slip.toFixed(2)}% ${slip > 1.5 ? "БЛОК" : "ok"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });