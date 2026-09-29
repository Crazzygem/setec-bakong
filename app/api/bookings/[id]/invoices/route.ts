import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  getBooking,
  unbilledLines,
  initialRoomLineId,
  pendingInvoiceFor,
  markInvoiceExpired,
  createInvoice,
  type BookingLines,
} from "@/lib/db";
import { generateInvoiceQR, INVOICE_TTL_MS } from "@/lib/bakong";
import { invoiceJson, settleIfPaid } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: bookingId } = await ctx.params;
  const booking = getBooking(bookingId);
  if (!booking) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (booking.status !== "ACTIVE") return NextResponse.json({ error: "booking closed" }, { status: 409 });

  // Retrying returns the open QR instead of minting a second one.
  const existing = pendingInvoiceFor(bookingId);
  if (existing) {
    if (existing.expires_at > Date.now()) return NextResponse.json({ invoice: invoiceJson(existing) });
    // A late payment settles instead of being billed twice.
    if (!(await settleIfPaid(existing, { force: true }))) markInvoiceExpired(existing.id);
  }

  const lines = unbilledLines(bookingId);
  const total = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  if (lines.length === 0 || total <= 0) return NextResponse.json({ error: "Nothing to pay yet." }, { status: 409 });
  if (new Set(lines.map((l) => l.currency)).size > 1)
    return NextResponse.json({ error: "The bill mixes currencies. Restart the server to re-price it." }, { status: 409 });

  // Only post-check-in extensions lengthen the stay: the check-in grant is already inside ends_at.
  const grantId = initialRoomLineId(bookingId);
  const extendHours = lines.filter((l) => l.kind === "ROOM_HOURS" && l.id !== grantId).reduce((s, l) => s + l.qty, 0);
  const snapshot: BookingLines = { tabItemIds: lines.map((l) => l.id), extendHours };

  // One retry covers the rare md5 UNIQUE collision.
  for (let attempt = 0; attempt < 2; attempt++) {
    const invoiceId = "inv_" + randomUUID().slice(0, 8);
    const gen = generateInvoiceQR({ invoiceId, amount: total });
    if (!gen.result) return NextResponse.json({ error: gen.error?.message ?? "QR generation failed" }, { status: 422 });
    try {
      const inv = createInvoice({
        id: invoiceId,
        bookingId,
        total,
        currency: gen.currency,
        qr: gen.result.qr,
        md5: gen.result.md5,
        lines: snapshot,
        expiresAt: Date.now() + INVOICE_TTL_MS,
      });
      return NextResponse.json({ invoice: invoiceJson(inv) }, { status: 201 });
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("UNIQUE") && attempt === 0) continue;
      return NextResponse.json({ error: "invoice create failed" }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "invoice create failed" }, { status: 500 });
}
