import { NextResponse } from "next/server";
import { getInvoice, markInvoiceExpired } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Staff drops a waiting QR. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const inv = getInvoice(id);
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (inv.status !== "PENDING") return NextResponse.json({ status: inv.status });
  markInvoiceExpired(inv.id);
  return NextResponse.json({ status: "EXPIRED" });
}
