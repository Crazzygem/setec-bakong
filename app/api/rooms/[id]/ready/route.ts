import { NextResponse } from "next/server";
import { getRoomById, setRoomStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = getRoomById(id);
  if (!room) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (room.status !== "CLEANING") return NextResponse.json({ error: "room is not awaiting cleaning" }, { status: 409 });
  setRoomStatus(id, "AVAILABLE");
  return NextResponse.json({ room: getRoomById(id) });
}
