import { NextResponse } from "next/server";
import { COOKIE, createSession } from "@/lib/session";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  const expectedEmail = (process.env.ADMIN_EMAIL || "admin@meteora.local").toLowerCase().trim();
  const expectedPass = process.env.ADMIN_PASSWORD || "";
  if (!expectedPass) return Response.json({ error: "ADMIN_PASSWORD не задан в .env" }, { status: 500 });

  if (String(email || "").toLowerCase().trim() !== expectedEmail || String(password || "") !== expectedPass) {
    return NextResponse.json({ error: "Неверный email или пароль" }, { status: 401 });
  }

  const token = await createSession(expectedEmail);
  const res = NextResponse.json({ ok: true, email: expectedEmail });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
