import { NextResponse } from "next/server";
import { getInvoice, markInvoiceExpired } from "@/lib/db";
import { settleIfPaid } from "@/lib/payments";

export const dynamic = "force-dynamic";

/** Staff drops a waiting QR. Bakong is asked once more so a paid bill is never voided. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const inv = getInvoice(id);
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (inv.status !== "PENDING") return NextResponse.json({ status: inv.status });
  if (await settleIfPaid(inv, { force: true })) return NextResponse.json({ status: "PAID" });
  markInvoiceExpired(inv.id);
  return NextResponse.json({ status: "EXPIRED" });
}
