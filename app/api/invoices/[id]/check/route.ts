import { NextResponse } from "next/server";
import { getInvoice, markInvoiceExpired } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Local status only, so screens can poll it freely: it never calls Bakong. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const inv = getInvoice(id);
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (inv.status !== "PENDING") return NextResponse.json({ status: inv.status });
  if (inv.expires_at <= Date.now()) {
    markInvoiceExpired(inv.id);
    return NextResponse.json({ status: "EXPIRED" });
  }
  return NextResponse.json({ status: "PENDING" });
}
