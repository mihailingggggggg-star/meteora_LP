import { env } from "./env.js";

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

// ── общий лимитер запросов к GeckoTerminal (бесплатный тариф ~30/мин)
let lastGeckoCall = 0;
async function geckoThrottle() {
  const wait = Math.max(0, 1100 - (Date.now() - lastGeckoCall));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeckoCall = Date.now();
}

async function getJson(url: string, attempt = 0): Promise<any> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (env.geckoKey) headers["x-api-key"] = env.geckoKey;
  const res = await fetch(url, { headers });
  if (res.status === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** Свечи пула с GeckoTerminal. Цена — в котируемом токене (как в пуле, НЕ в USD!). */
export async function fetchCandles(
  poolAddress: string,
  opts: { timeframe?: "minute" | "hour" | "day"; aggregate?: number; limit?: number } = {},
): Promise<Candle[]> {
  const timeframe = opts.timeframe ?? "minute";
  const aggregate = opts.aggregate ?? 5;
  const limit = opts.limit ?? 288;
  const url = `${env.geckoBase}/networks/solana/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=token`;
  await geckoThrottle();
  const data = await getJson(url);
  const list = data?.data?.attributes?.ohlcv_list ?? [];
  // Gecko отдаёт [ts, o, h, l, c, v] в порядке новых→старых
  const seen = new Set<number>();
  return list
    .map((r: any[]) => ({ t: Number(r[0]) * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }))
    .filter((c: Candle) => c.c > 0 && Number.isFinite(c.c) && Number.isFinite(c.t))
    .sort((a: Candle, b: Candle) => a.t - b.t)
    .filter((c: Candle) => {
      if (seen.has(c.t)) return false;
      seen.add(c.t);
      return true;
    });
}

/** Свечи с официального Meteora Data API. Цена — в единицах пула (quote-токен). */
export async function fetchMeteoraCandles(
  poolAddress: string,
  timeframe: "5m" | "30m" | "1h" | "2h" | "4h" | "12h" | "24h",
  hoursWanted: number,
): Promise<Candle[]> {
  // API ограничивает длину диапазона — пробуем по убыванию, пока не ответит 200
  const tries = [hoursWanted, Math.round(hoursWanted / 2), Math.round(hoursWanted / 4), 24].filter(
    (h, i, a) => h >= 6 && a.indexOf(h) === i,
  );
  for (const hours of tries) {
    const now = Math.floor(Date.now() / 1000);
    const start = now - Math.round(hours * 3600);
    try {
      const res = await fetch(
        `${env.meteoraApi}/pools/${poolAddress}/ohlcv?timeframe=${timeframe}&start_time=${start}&end_time=${now}`,
        { headers: { accept: "application/json" } },
      );
      if (!res.ok) continue;
      const data = await res.json();
      const rows = Array.isArray(data?.data) ? data.data : [];
      if (rows.length < 5) continue;
      return rows
        .map((r: any) => ({
          t: Number(r.timestamp) * 1000,
          o: Number(r.open),
          h: Number(r.high),
          l: Number(r.low),
          c: Number(r.close),
          v: Number(r.volume ?? 0),
        }))
        .filter((c: Candle) => c.c > 0 && Number.isFinite(c.t))
        .sort((a: Candle, b: Candle) => a.t - b.t);
    } catch {
      /* пробуем меньший диапазон */
    }
  }
  return [];
}

export async function fetchGeckoPool(poolAddress: string): Promise<any | null> {
  try {
    const data = await getJson(`${env.geckoBase}/networks/solana/pools/${poolAddress}`);
    const a = data?.data?.attributes;
    if (!a) return null;
    return {
      price: Number(a.base_token_price_usd),
      fdv: Number(a.fdv_usd),
      liquidity: Number(a.reserve_in_usd),
      vol24: Number(a.volume_usd?.h24 ?? 0),
      vol1h: Number(a.volume_usd?.h1 ?? 0),
      change5m: Number(a.price_change_percentage?.m5 ?? 0),
      change1h: Number(a.price_change_percentage?.h1 ?? 0),
      change24h: Number(a.price_change_percentage?.h24 ?? 0),
      name: a.name,
    };
  } catch {
    return null;
  }
}

/** Котировка Jupiter — для честной оценки издержек выхода и проверки «honeypot». */
export async function jupiterQuote(
  inputMint: string,
  outputMint: string,
  amountRaw: string,
  slippageBps = 100,
): Promise<{ outAmount: number; priceImpactPct: number } | null> {
  try {
    const url = `${env.jupiterBase}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=${slippageBps}`;
    const data = await getJson(url);
    return {
      outAmount: Number(data.outAmount),
      priceImpactPct: Number(data.priceImpactPct ?? 0) * 100,
    };
  } catch {
    return null;
  }
}
