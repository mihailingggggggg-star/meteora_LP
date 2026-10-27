import { NextResponse, type NextRequest } from "next/server";
import nacl from "tweetnacl";
import * as bs58mod from "bs58";
import { buildMessage } from "@/lib/siws";

export const dynamic = "force-dynamic";

const b58decode = (s: string): Uint8Array => {
  const mod: any = bs58mod as any;
  const fn = mod.decode ?? mod.default?.decode;
  return fn(s);
};

export async function POST(req: NextRequest) {
  const { address, signature } = await req.json().catch(() => ({}));
  const nonce = req.cookies.get("mt_siws")?.value;
  if (!address || !signature || !nonce) {
    return NextResponse.json({ error: "missing data" }, { status: 400 });
  }
  const host = req.headers.get("host") || "localhost:3000";
  const message = buildMessage(address, nonce, host);
  try {
    const ok = nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      b58decode(signature),
      b58decode(address),
    );
    if (!ok) return NextResponse.json({ error: "Подпись не совпала" }, { status: 401 });
  } catch (err: any) {
    return NextResponse.json({ error: `Ошибка проверки подписи: ${err?.message ?? err}` }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true, address });
  res.cookies.set("mt_wallet", address, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  res.cookies.set("mt_siws", "", { path: "/", maxAge: 0 });
  return res;
}
