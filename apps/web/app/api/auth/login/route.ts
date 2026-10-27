import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { COOKIE, authConfigured, createSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Защита от подбора пароля: 5 неудачных попыток за 10 минут → блокировка IP на 10 минут.
 * Счётчики в памяти процесса (один инстанс веба) — этого достаточно, чтобы
 * перебор 11-символьного пароля перестал быть практичным.
 */
const WINDOW_MS = 10 * 60_000;
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60_000;
const FAIL_DELAY_MS = 300;

type Bucket = { fails: number; first: number; lockedUntil: number };
const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || "local";
}

function bucketFor(ip: string): Bucket {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) {
    b = { fails: 0, first: now, lockedUntil: 0 };
    buckets.set(ip, b);
  }
  if (b.lockedUntil && b.lockedUntil <= now) {
    b.lockedUntil = 0;
    b.fails = 0;
    b.first = now;
  }
  if (!b.lockedUntil && now - b.first > WINDOW_MS) {
    b.fails = 0;
    b.first = now;
  }
  if (buckets.size > 5000) buckets.clear(); // страховка от роста памяти
  return b;
}

const sha = (v: string) => createHash("sha256").update(v, "utf8").digest();

/** Сравнение без утечки по времени (хеши одинаковой длины). */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha(a), sha(b));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  if (!authConfigured()) {
    return NextResponse.json(
      { error: "Вход не настроен: задайте AUTH_SECRET в .env и перезапустите сервис" },
      { status: 503 },
    );
  }

  const ip = clientIp(req);
  const bucket = bucketFor(ip);
  const now = Date.now();
  if (bucket.lockedUntil > now) {
    const retry = Math.ceil((bucket.lockedUntil - now) / 1000);
    return NextResponse.json(
      { error: `Слишком много попыток входа. Повторите через ${Math.ceil(retry / 60)} мин.` },
      { status: 429, headers: { "retry-after": String(retry) } },
    );
  }

  const { email, password } = await req.json().catch(() => ({}) as any);
  const expectedEmail = (process.env.ADMIN_EMAIL || "admin@meteora.local").toLowerCase().trim();
  const expectedPass = process.env.ADMIN_PASSWORD || "";
  if (!expectedPass) {
    return NextResponse.json({ error: "ADMIN_PASSWORD не задан в .env" }, { status: 500 });
  }

  const givenEmail = String(email || "").toLowerCase().trim();
  const givenPass = String(password || "");
  // оба сравнения выполняются всегда — чтобы не подсказывать, какое поле неверно
  const emailOk = safeEqual(givenEmail, expectedEmail);
  const passOk = safeEqual(givenPass, expectedPass);

  if (!emailOk || !passOk) {
    await sleep(FAIL_DELAY_MS);
    bucket.fails += 1;
    const locked = bucket.fails >= MAX_FAILS;
    if (locked) bucket.lockedUntil = Date.now() + LOCK_MS;
    console.warn(
      `[auth] неудачный вход ip=${ip} login=${givenEmail.slice(0, 64)} попыток=${bucket.fails}/${MAX_FAILS}` +
        (locked ? " → IP заблокирован на 10 мин" : ""),
    );
    return NextResponse.json(
      { error: locked ? "Слишком много попыток. Вход заблокирован на 10 минут." : "Неверный email или пароль" },
      { status: locked ? 429 : 401 },
    );
  }

  bucket.fails = 0;
  bucket.first = Date.now();

  const token = await createSession(expectedEmail);
  const res = NextResponse.json({ ok: true, email: expectedEmail });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  console.log(`[auth] успешный вход ip=${ip} login=${expectedEmail}`);
  return res;
}
