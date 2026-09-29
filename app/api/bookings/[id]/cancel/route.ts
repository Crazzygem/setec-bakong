import { NextResponse } from "next/server";
import { cancelBooking, errStatus, getBooking, pendingInvoiceFor } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { settleIfPaid } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getBooking(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  // If the open QR was just paid, stop so staff see the payment before deciding again.
  const open = pendingInvoiceFor(id);
  if (open && (await settleIfPaid(open, { force: true }))) {
    return NextResponse.json(
      { error: `The open QR was just paid (${formatMoney(open.total, open.currency)}). Review the bill before cancelling.` },
      { status: 409 }
    );
  }

  try {
    return NextResponse.json({ ok: true, ...cancelBooking(id) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "cancel failed" }, { status: errStatus(e) });
  }
}
