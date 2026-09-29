import { NextResponse } from "next/server";
import { createBooking, getRoomById, errStatus, listBookings } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ bookings: listBookings() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { roomId, customerName, hours } = body ?? {};
    if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 });
    if (!Number.isInteger(Number(hours)) || Number(hours) < 1 || Number(hours) > 12)
      return NextResponse.json({ error: "hours must be an integer 1–12" }, { status: 400 });
    const room = getRoomById(String(roomId));
    if (!room) return NextResponse.json({ error: "room not found" }, { status: 404 });
    const booking = createBooking({
      roomId: room.id,
      customerName: String(customerName ?? "").trim() || "Walk-in",
      hours: Number(hours),
    });
    return NextResponse.json({ booking }, { status: 201 });
  } catch (e: unknown) {
    const status = errStatus(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "booking failed" }, { status });
  }
}
