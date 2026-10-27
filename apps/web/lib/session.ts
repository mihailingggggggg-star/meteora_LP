import { SignJWT, jwtVerify } from "jose";

export const COOKIE = "mt_session";

/**
 * Ключ подписи сессий.
 *
 * Раньше здесь был дефолт `dev-secret-change-me` — то есть при отсутствии AUTH_SECRET
 * любой мог подделать cookie с ролью владельца. Теперь поведение «fail-closed»:
 * в production без валидного секрета сессии не читаются и не выдаются.
 */
let cached: Uint8Array | null = null;
let warned = false;

function secret(): Uint8Array | null {
  if (cached) return cached;
  const raw = (process.env.AUTH_SECRET || "").trim();
  if (raw.length >= 16) {
    cached = new TextEncoder().encode(raw);
    return cached;
  }
  if (process.env.NODE_ENV === "production") {
    if (!warned) {
      warned = true;
      console.error(
        "[auth] AUTH_SECRET не задан или короче 16 символов — вход в терминал заблокирован. " +
          "Задайте AUTH_SECRET в .env (openssl rand -base64 32) и перезапустите meteora-web.",
      );
    }
    return null;
  }
  if (!warned) {
    warned = true;
    console.warn("[auth] AUTH_SECRET не задан — dev-режим, использую временный секрет.");
  }
  cached = new TextEncoder().encode("dev-only-insecure-secret");
  return cached;
}

/** Настроен ли вход: false — показываем честную ошибку вместо «неверный пароль». */
export function authConfigured(): boolean {
  return secret() !== null;
}

export type SessionPayload = { email: string; role: "owner" };

export async function createSession(email: string) {
  const key = secret();
  if (!key) throw new Error("AUTH_SECRET не задан — выдача сессий запрещена");
  return new SignJWT({ email, role: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(key);
}

export async function readSession(token?: string): Promise<SessionPayload | null> {
  if (!token) return null;
  const key = secret();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    return { email: String(payload.email), role: "owner" };
  } catch {
    return null;
  }
}
