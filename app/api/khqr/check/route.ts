import { NextResponse } from "next/server";
import { liveVerificationEnabled, verifyTxByMd5 } from "@/lib/bakong";
import { isCurrency } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Raw Bakong md5 lookup for the test page, so a real test payment can be traced. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { md5?: string; amount?: number | null; currency?: string };
  if (!body.md5 || !/^[a-f0-9]{32}$/i.test(body.md5)) return NextResponse.json({ error: "md5 required" }, { status: 400 });
  if (!liveVerificationEnabled()) return NextResponse.json({ error: "BAKONG_TOKEN is not set." }, { status: 503 });
  const expected =
    body.amount != null && isCurrency(body.currency) ? { amount: Number(body.amount), currency: body.currency } : undefined;
  return NextResponse.json(await verifyTxByMd5(body.md5, expected));
}
