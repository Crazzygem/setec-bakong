import { NextResponse } from "next/server";
import { getInvoice, settleInvoicePaid } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Staff confirm the money arrived (they saw it in the Bakong app). Nothing here calls
 * Bakong, so approving costs no API quota.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const inv = getInvoice(id);
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (inv.status === "PAID") return NextResponse.json({ status: "PAID" });
  if (inv.status !== "PENDING" || inv.expires_at <= Date.now())
    return NextResponse.json({ error: "This QR is no longer waiting for payment. Make a new QR." }, { status: 409 });
  settleInvoicePaid(inv.id);
  return NextResponse.json({ status: "PAID" });
}
