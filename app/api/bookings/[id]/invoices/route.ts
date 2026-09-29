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
import { generateInvoiceQR, sourceAcceptsCurrency, INVOICE_TTL_MS } from "@/lib/bakong";
import { isCurrency, toBillAmount } from "@/lib/money";
import { shopCurrency } from "@/lib/shop";
import { invoiceJson } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: bookingId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { currency?: string } | null;
  const booking = getBooking(bookingId);
  if (!booking) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (booking.status !== "ACTIVE") return NextResponse.json({ error: "booking closed" }, { status: 409 });

  // Retrying returns the open QR instead of minting a second one.
  const existing = pendingInvoiceFor(bookingId);
  if (existing) {
    if (existing.expires_at > Date.now()) return NextResponse.json({ invoice: invoiceJson(existing) });
    markInvoiceExpired(existing.id);
  }

  const lines = unbilledLines(bookingId);
  const tabTotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  if (lines.length === 0 || tabTotal <= 0) return NextResponse.json({ error: "Nothing to pay yet." }, { status: 409 });
  if (new Set(lines.map((l) => l.currency)).size > 1)
    return NextResponse.json({ error: "The bill mixes currencies. Restart the server to re-price it." }, { status: 409 });

  // Staff choose the currency to charge. The tab was priced in one currency, so a bill in
  // the other is converted once here and the invoice carries the converted total.
  const tabCurrency = lines[0].currency;
  const currency = isCurrency(body?.currency) ? body.currency : shopCurrency();
  const { total, rounded } = currency === tabCurrency
    ? { total: tabTotal, rounded: false }
    : toBillAmount(tabTotal, tabCurrency, currency);
  if (currency !== tabCurrency && total <= 0)
    return NextResponse.json({ error: "That amount is too small to charge in " + currency + "." }, { status: 409 });

  // A single-currency account cannot take a bill in the other currency, and the bank app
  // would fail the account inquiry rather than say so.
  const source = process.env.MERCHANT_KHQR_SOURCE?.trim();
  if (source && !sourceAcceptsCurrency(source, currency))
    return NextResponse.json(
      { error: `This KHQR account only takes ${tabCurrency} bills. Charge in ${tabCurrency}, or use a dual-currency account.` },
      { status: 422 }
    );

  // Only post-check-in extensions lengthen the stay: the check-in grant is already inside ends_at.
  const grantId = initialRoomLineId(bookingId);
  const extendHours = lines.filter((l) => l.kind === "ROOM_HOURS" && l.id !== grantId).reduce((s, l) => s + l.qty, 0);
  const snapshot: BookingLines = { tabItemIds: lines.map((l) => l.id), extendHours };

  // One retry covers the rare md5 UNIQUE collision.
  for (let attempt = 0; attempt < 2; attempt++) {
    const invoiceId = "inv_" + randomUUID().slice(0, 8);
    const gen = generateInvoiceQR({ invoiceId, amount: total, currency });
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
      // original/rounded let staff show the guest the riel tab next to the dollar charge.
      return NextResponse.json(
        { invoice: invoiceJson(inv), original: { total: tabTotal, currency: tabCurrency }, rounded },
        { status: 201 }
      );
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("UNIQUE") && attempt === 0) continue;
      return NextResponse.json({ error: "invoice create failed" }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "invoice create failed" }, { status: 500 });
}
