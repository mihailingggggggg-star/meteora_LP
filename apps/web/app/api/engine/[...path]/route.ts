import type { NextRequest } from "next/server";
import { COOKIE, readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// читаем в рантайме (не на этапе сборки) — порт движка на сервере может отличаться
const ENGINE = process.env["ENGINE_URL"] || "http://127.0.0.1:8787";

async function proxy(req: NextRequest, path: string[]) {
  const url = `${ENGINE}/api/${path.join("/")}${req.nextUrl.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: { accept: req.headers.get("accept") || "application/json" },
    cache: "no-store",
  };
  if (req.method === "POST") {
    init.body = await req.text();
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
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
  return proxy(req, params.path);
}
