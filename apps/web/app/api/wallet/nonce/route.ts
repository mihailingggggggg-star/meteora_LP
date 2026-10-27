import { NextResponse, type NextRequest } from "next/server";
import { buildMessage } from "@/lib/siws";

export const dynamic = "force-dynamic";


export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const host = req.headers.get("host") || "localhost:3000";
  const message = buildMessage(address, nonce, host);
  const res = NextResponse.json({ message, nonce });
  res.cookies.set("mt_siws", nonce, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 300 });
  return res;
}
