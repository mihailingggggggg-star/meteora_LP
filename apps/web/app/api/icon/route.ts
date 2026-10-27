import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type Entry = { url: string | null; at: number };
const cache = new Map<string, Entry>();
const TTL = 24 * 3600_000;

const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="16" fill="#1b1510"/><circle cx="32" cy="32" r="12" fill="#3a2d20"/></svg>`;

async function resolve(mint: string): Promise<string | null> {
  // GeckoTerminal — основной источник иконок
  try {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}`, {
      headers: { accept: "application/json" },
      next: { revalidate: 86400 },
    });
    if (res.ok) {
      const data = await res.json();
      const url = data?.data?.attributes?.image_url;
      if (url) return String(url).replace("/large/", "/thumb/");
    }
  } catch {
    /* fallback ниже */
  }
  // DexScreener — резервный
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { next: { revalidate: 86400 } });
    if (res.ok) {
      const data = await res.json();
      const url = Array.isArray(data) ? data[0]?.info?.imageUrl : null;
      if (url) return url;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint");
  if (!mint) return new NextResponse(PLACEHOLDER, { headers: { "content-type": "image/svg+xml" } });

  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < TTL && hit.url) {
    return NextResponse.redirect(hit.url, { headers: { "cache-control": "public, max-age=86400" } });
  }

  const url = await resolve(mint);
  cache.set(mint, { url, at: Date.now() });
  if (!url) return new NextResponse(PLACEHOLDER, { headers: { "content-type": "image/svg+xml" } });
  return NextResponse.redirect(url, {
    headers: { "cache-control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}
