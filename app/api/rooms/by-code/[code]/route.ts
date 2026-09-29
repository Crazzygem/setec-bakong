import { NextResponse } from "next/server";
import { getRoomByCode, getActiveBookingForRoom, listTabItems, unbilledTotal, listMenu, pendingInvoiceFor } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const room = getRoomByCode(decodeURIComponent(code));
  if (!room) return NextResponse.json({ error: "not found" }, { status: 404 });
  const booking = getActiveBookingForRoom(room.id) ?? null;
  const tab = booking ? listTabItems(booking.id) : [];
  return NextResponse.json({
    room,
    booking,
    tab,
    unbilledTotal: booking ? unbilledTotal(booking.id) : 0,
    menu: listMenu(false),
    // Lets the POS resume an open QR after staff switch rooms and come back.
    pendingInvoiceId: booking ? pendingInvoiceFor(booking.id)?.id ?? null : null,
  });
}
