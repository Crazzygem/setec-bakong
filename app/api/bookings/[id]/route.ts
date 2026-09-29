import { NextResponse } from "next/server";
import { getBooking, listTabItems, unbilledTotal, getRoomById } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const booking = getBooking(id);
  if (!booking) return NextResponse.json({ error: "not found" }, { status: 404 });
  const room = getRoomById(booking.room_id);
  return NextResponse.json({
    booking,
    room,
    tab: listTabItems(booking.id),
    unbilledTotal: unbilledTotal(booking.id),
  });
}
