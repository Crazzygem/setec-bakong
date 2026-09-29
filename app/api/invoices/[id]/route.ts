import { NextResponse } from "next/server";
import { getInvoice, getBooking, getRoomById } from "@/lib/db";
import { invoiceJson } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // No expiry here: /check owns PENDING -> EXPIRED.
  const inv = getInvoice(id);
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 });
  const booking = getBooking(inv.booking_id);
  const room = booking ? getRoomById(booking.room_id) : null;
  return NextResponse.json({
    invoice: invoiceJson(inv),
    room: room ? { code: room.code, name: room.name } : null,
  });
}
