import { NextResponse } from "next/server";
import { decodeKhqr } from "@/lib/bakong";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { qr?: string };
  const qr = String(body.qr ?? "").trim();
  if (!qr.startsWith("000201")) return NextResponse.json({ error: "That is not a KHQR/EMV payment code" }, { status: 400 });
  try {
    return NextResponse.json(decodeKhqr(qr));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "decode failed" }, { status: 422 });
  }
}
