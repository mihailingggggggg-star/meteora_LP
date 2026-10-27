import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const address = req.cookies.get("mt_wallet")?.value ?? null;
  return NextResponse.json({ address });
}
