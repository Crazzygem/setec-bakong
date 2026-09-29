import { NextResponse } from "next/server";
import { getInvoice, settleInvoicePaid } from "@/lib/db";
import { liveVerificationEnabled, verifyTxByMd5 } from "@/lib/bakong";

export const dynamic = "force-dynamic";

const QUOTA_ERROR_CODE = 17;

/**
 * One Bakong lookup per click (staff button). Nothing calls this on a timer, because each
 * call counts against Bakong's 100 md5 checks per token per day.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const inv = getInvoice(id);
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (inv.status === "PAID") return NextResponse.json({ status: "PAID", paid: true });
  if (inv.status !== "PENDING" || inv.expires_at <= Date.now())
    return NextResponse.json({ error: "This QR is no longer waiting for payment. Make a new QR." }, { status: 409 });
  if (!liveVerificationEnabled()) return NextResponse.json({ error: "BAKONG_TOKEN is not set." }, { status: 503 });

  const { paid, raw } = await verifyTxByMd5(inv.md5, { amount: inv.total, currency: inv.currency });
  const code = (raw as { errorCode?: unknown })?.errorCode;
  if (code === QUOTA_ERROR_CODE)
    return NextResponse.json({ error: "Bakong's daily check limit is used up. Use Confirm payment received instead." }, { status: 429 });
  if (!paid) return NextResponse.json({ status: "PENDING", paid: false });
  settleInvoicePaid(inv.id);
  return NextResponse.json({ status: "PAID", paid: true });
}
