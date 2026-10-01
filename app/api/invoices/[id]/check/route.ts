import { NextResponse } from "next/server";
import { getInvoice, markInvoiceExpired } from "@/lib/db";
import { autoCheckEnabled, bakongQuotaExhausted, settleIfPaid } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * Screens poll this every few seconds. It reads the local database and, only when the admin
 * has turned auto-check on, asks Bakong at most once per invoice every AUTO_GAP_MS.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const inv = getInvoice(id);
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (inv.status !== "PENDING") return NextResponse.json({ status: inv.status });

  const auto = autoCheckEnabled();
  const expired = inv.expires_at <= Date.now();
  // At expiry, ask once more regardless of spacing, so a payment made at 4:59 still settles.
  if (auto && (await settleIfPaid(inv, { force: expired }))) return NextResponse.json({ status: "PAID", auto });
  if (expired) {
    markInvoiceExpired(inv.id);
    return NextResponse.json({ status: "EXPIRED", auto });
  }
  return NextResponse.json({ status: "PENDING", auto, quotaBlocked: auto && bakongQuotaExhausted() });
}
