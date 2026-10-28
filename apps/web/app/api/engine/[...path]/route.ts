import type { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { COOKIE, readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// читаем в рантайме (не на этапе сборки) — порт движка на сервере может отличаться
const ENGINE = process.env["ENGINE_URL"] || "http://127.0.0.1:8787";
const ENGINE_TOKEN = (process.env["ENGINE_TOKEN"] || "").trim();
const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] || "";

/**
 * Действия, которые меняют деньги: подключение кошелька, переключение демо/live,
 * сброс истории. Для них нужно заново ввести пароль администратора —
 * украденной cookie недостаточно.
 */
const SENSITIVE = new Set(["live/wallet", "live/mode", "live/alerts", "bot/reset"]);

function isSensitive(path: string[]): boolean {
  return SENSITIVE.has(`${path[0]}/${path[1]}`);
}

function passwordOk(given: string): boolean {
  if (!ADMIN_PASSWORD) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(ADMIN_PASSWORD).digest();
  return timingSafeEqual(a, b);
}

function upstreamHeaders(req: NextRequest): Record<string, string> {
  const headers: Record<string, string> = { accept: req.headers.get("accept") || "application/json" };
  // движок принимает запросы только с токеном (если он задан в .env)
  if (ENGINE_TOKEN) headers.authorization = `Bearer ${ENGINE_TOKEN}`;
  if (req.method === "POST") headers["content-type"] = "application/json";
  return headers;
}

async function proxy(req: NextRequest, path: string[]) {
  const url = `${ENGINE}/api/${path.join("/")}${req.nextUrl.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: upstreamHeaders(req),
    cache: "no-store",
  };
  if (req.method === "POST") init.body = await req.text();

  const res = await fetch(url, init);
  const headers = new Headers();
  headers.set("content-type", res.headers.get("content-type") || "application/json");
  headers.set("cache-control", "no-store");
  return new Response(res.body, { status: res.status, headers });
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const session = await readSession(req.cookies.get(COOKIE)?.value);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  return proxy(req, params.path);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  const session = await readSession(req.cookies.get(COOKIE)?.value);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (isSensitive(params.path) && !passwordOk(req.headers.get("x-admin-pass") || "")) {
    return Response.json({ error: "подтвердите паролем администратора" }, { status: 403 });
  }
  return proxy(req, params.path);
}

export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  const session = await readSession(req.cookies.get(COOKIE)?.value);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (isSensitive(params.path) && !passwordOk(req.headers.get("x-admin-pass") || "")) {
    return Response.json({ error: "подтвердите паролем администратора" }, { status: 403 });
  }
  return proxy(req, params.path);
}
