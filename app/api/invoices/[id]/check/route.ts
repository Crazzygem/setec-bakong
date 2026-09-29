import { NextResponse } from "next/server";
import { getInvoice, markInvoiceExpired } from "@/lib/db";
import { liveVerificationEnabled } from "@/lib/bakong";
import { bakongQuotaExhausted, settleIfPaid } from "@/lib/payments";

export const dynamic = "force-dynamic";

const QUOTA_WARNING = "Bakong's daily check limit is used up, so payments cannot be confirmed automatically until midnight.";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const inv = getInvoice(id);
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 });
  const live = liveVerificationEnabled();
  if (inv.status !== "PENDING") return NextResponse.json({ status: inv.status, live });

  // At expiry, ask Bakong once more regardless of spacing, so a payment made at 4:59 still settles.
  const expired = inv.expires_at <= Date.now();
  if (await settleIfPaid(inv, { force: expired })) return NextResponse.json({ status: "PAID", live });
  if (expired) {
    markInvoiceExpired(inv.id);
    return NextResponse.json({ status: "EXPIRED", live });
  }
  return NextResponse.json({ status: "PENDING", live, warning: live && bakongQuotaExhausted() ? QUOTA_WARNING : undefined });
}
