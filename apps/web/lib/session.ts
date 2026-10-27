import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me");
export const COOKIE = "mt_session";

export type SessionPayload = { email: string; role: "owner" };

export async function createSession(email: string) {
  return new SignJWT({ email, role: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function readSession(token?: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return { email: String(payload.email), role: "owner" };
  } catch {
    return null;
  }
}
