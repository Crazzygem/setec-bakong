import { NextResponse } from "next/server";
import { getInvoice, settleInvoicePaid } from "@/lib/db";
import { simulateEnabled, liveVerificationEnabled } from "@/lib/bakong";

export const dynamic = "force-dynamic";

/** Demo only: marks an invoice paid without a transfer. Off when a token is set unless SIMULATE_PAYMENTS=true. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (liveVerificationEnabled() && !simulateEnabled())
    return NextResponse.json({ error: "simulation disabled" }, { status: 403 });
  const inv = getInvoice(id);
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (inv.status !== "PENDING" || inv.expires_at <= Date.now())
    return NextResponse.json({ error: "This QR is no longer waiting for payment." }, { status: 409 });
  settleInvoicePaid(inv.id);
  return NextResponse.json({ status: "PAID", demo: true });
}
