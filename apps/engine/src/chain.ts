import { Connection, PublicKey } from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";
import { env } from "./env.js";
import type { Pool } from "./meteora.js";

export type BinLiquidity = { binId: number; k: number; priceRel: number; usd: number };

let connection: Connection | null = null;
export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(env.rpcUrl, { commitment: "confirmed" });
  }
  return connection;
}

const poolCache = new Map<string, { dlmm: any; at: number }>();

async function getDlmm(address: string) {
  const hit = poolCache.get(address);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.dlmm;
  const dlmm = await DLMM.create(getConnection(), new PublicKey(address), { cluster: "mainnet-beta" });
  poolCache.set(address, { dlmm, at: Date.now() });
  return dlmm;
}

const bnToNum = (v: any): number => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v?.toNumber === "function") return v.toNumber();
  return Number(v) || 0;
};

/**
 * Ликвидность по бинам вокруг активного бина (в USD).
 * Возвращает null, если RPC/цепь недоступны — тогда движок работает в «degraded» режиме.
 */
export async function readBinLiquidity(
  pool: Pool,
  spanPct = 0.16,
): Promise<{ activePrice: number; bins: BinLiquidity[]; source: "chain" | "estimate" }> {
  const step = pool.binStep / 10_000;
  try {
    const dlmm = await getDlmm(pool.address);
    const active = await dlmm.getActiveBin();
    const activeBinId = Number(active.binId);
    const activePrice = Number(active.price) || pool.currentPrice;
    const kMin = -Math.ceil(Math.log(1 + spanPct) / Math.log(1 + step));
    const kMax = Math.ceil(Math.log(1 + 0.02) / Math.log(1 + step));
    const res = await dlmm.getBinsBetweenLowerAndUpperBound(activeBinId + kMin, activeBinId + kMax);
    const decX = pool.tokenX.decimals;
    const decY = pool.tokenY.decimals;
    const px = pool.tokenX.price > 0 ? pool.tokenX.price : pool.tokenY.price / (pool.currentPrice || 1);
    const py = pool.tokenY.price > 0 ? pool.tokenY.price : 1;
    const bins: BinLiquidity[] = (res.bins || []).map((b: any) => {
      const k = Number(b.binId) - activeBinId;
      const usdX = (bnToNum(b.xAmount) / 10 ** decX) * px;
      const usdY = (bnToNum(b.yAmount) / 10 ** decY) * py;
      return {
        binId: Number(b.binId),
        k,
        priceRel: Math.pow(1 + step, k),
        usd: Math.max(0, usdX + usdY),
      };
    });
    if (!bins.length) throw new Error("empty bins");
    return { activePrice, bins, source: "chain" };
  } catch {
    // Оценка: TVL размазан по диапазону ±span, берём долю на 1% цены
    const stepCount = Math.max(1, Math.round(0.02 / step));
    const total = Math.round(spanPct / step);
    const perBin = pool.tvl / Math.max(1, total * 2);
    const bins: BinLiquidity[] = [];
    for (let k = -total; k <= stepCount; k++) {
      bins.push({ binId: 0 - total + k, k, priceRel: Math.pow(1 + step, k), usd: perBin });
    }
    return { activePrice: pool.currentPrice, bins, source: "estimate" };
  }
}
