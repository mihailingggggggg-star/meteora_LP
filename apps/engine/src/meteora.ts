import { env } from "./env.js";

export type TokenInfo = {
  address: string;
  symbol: string;
  price: number;
  decimals: number;
  holders: number;
  freezeDisabled: boolean;
  verified: boolean;
  marketCap: number;
  totalSupply: number;
};

export type Pool = {
  address: string;
  name: string;
  binStep: number;
  baseFeePct: number;
  protocolFeePct: number;
  dynamicFeePct: number;
  tvl: number;
  vol24: number;
  vol1h: number;
  createdAt: number;
  currentPrice: number;
  tokenX: TokenInfo;
  tokenY: TokenInfo;
  isBlacklisted: boolean;
  launchpad: string;
  feeTvl24h: number;
  fees24: number;
  fees1h: number;
  fees30m: number;
};

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

function mapToken(t: any): TokenInfo {
  return {
    address: t?.address ?? "",
    symbol: t?.symbol ?? "?",
    price: num(t?.price),
    decimals: num(t?.decimals, 9),
    holders: num(t?.holders),
    freezeDisabled: !!t?.freeze_authority_disabled,
    verified: !!t?.is_verified,
    marketCap: num(t?.market_cap),
    totalSupply: num(t?.total_supply),
  };
}

export function mapPool(raw: any): Pool {
  return {
    address: raw.address,
    name: raw.name ?? "",
    binStep: num(raw.pool_config?.bin_step, 25),
    baseFeePct: num(raw.pool_config?.base_fee_pct),
    protocolFeePct: num(raw.pool_config?.protocol_fee_pct),
    dynamicFeePct: num(raw.dynamic_fee_pct),
    tvl: num(raw.tvl),
    vol24: num(raw.volume?.["24h"]),
    vol1h: num(raw.volume?.["1h"]),
    createdAt: num(raw.created_at),
    currentPrice: num(raw.current_price),
    tokenX: mapToken(raw.token_x),
    tokenY: mapToken(raw.token_y),
    isBlacklisted: !!raw.is_blacklisted,
    launchpad: raw.launchpad ?? "",
    feeTvl24h: num(raw.fee_tvl_ratio?.["24h"]),
    fees24: num(raw.fees?.["24h"]),
    fees1h: num(raw.fees?.["1h"]),
    fees30m: num(raw.fees?.["30m"]),
  };
}

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** Все пулы, отсортированные по TVL (страницами). */
export async function fetchPools(pageSize = 1000, sortBy = "tvl:desc"): Promise<Pool[]> {
  const url = `${env.meteoraApi}/pools?page_size=${pageSize}&page=1&sort_by=${encodeURIComponent(sortBy)}`;
  const data = await getJson(url);
  const list = Array.isArray(data?.data) ? data.data : [];
  return list.map(mapPool).filter((p) => p.address && p.tvl > 0);
}

export async function fetchPool(address: string): Promise<Pool | null> {
  try {
    const data = await getJson(`${env.meteoraApi}/pools/${address}`);
    const raw = data?.data ?? data;
    if (!raw?.address) return null;
    return mapPool(raw);
  } catch {
    return null;
  }
}

/** SOL-пара: возвращает true, если quote-токен — SOL. */
export function isSolPair(p: Pool) {
  return p.tokenY.address === env.wsolMint || p.tokenX.address === env.wsolMint;
}

/** Токен, который мы покупаем (не SOL), и цена SOL в USD. */
export function splitPair(p: Pool) {
  const solIsY = p.tokenY.address === env.wsolMint;
  const token = solIsY ? p.tokenX : p.tokenY;
  const sol = solIsY ? p.tokenY : p.tokenX;
  const solPrice = sol.price > 0 ? sol.price : 200;
  // цена токена в SOL
  const tokenPriceSol = solIsY ? p.currentPrice : p.currentPrice > 0 ? 1 / p.currentPrice : 0;
  return { token, sol, solPrice, tokenPriceSol, solIsY };
}
