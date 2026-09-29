import { NextResponse } from "next/server";
import { listRooms, createRoom } from "@/lib/db";
import { isMediaUrl } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const positiveInt = (v: unknown) => Number.isInteger(Number(v)) && Number(v) > 0;

export async function GET() {
  return NextResponse.json({ rooms: listRooms() });
}

export async function POST(req: Request) {
  const { code, name, hourlyRate, capacity, imageUrl } = (await req.json().catch(() => ({}))) ?? {};
  if (!String(code ?? "").trim() || !String(name ?? "").trim())
    return NextResponse.json({ error: "Room code and name are required." }, { status: 400 });
  if (!positiveInt(hourlyRate)) return NextResponse.json({ error: "Enter an hourly rate above zero." }, { status: 400 });
  if (!positiveInt(capacity)) return NextResponse.json({ error: "Enter how many seats the room has." }, { status: 400 });
  if (imageUrl !== undefined && imageUrl !== null && !isMediaUrl(imageUrl))
    return NextResponse.json({ error: "That image link is not valid." }, { status: 400 });
  try {
    const room = createRoom({
      code: String(code),
      name: String(name),
      hourlyRate: Number(hourlyRate),
      capacity: Number(capacity),
      imageUrl: imageUrl ?? null,
    });
    return NextResponse.json({ room }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "create failed";
    if (msg.includes("UNIQUE")) return NextResponse.json({ error: `Room ${String(code).toUpperCase()} already exists.` }, { status: 409 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
