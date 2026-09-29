import { NextResponse } from "next/server";
import { getRoomById, updateRoom } from "@/lib/db";
import { deleteImage, isMediaUrl } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const positiveInt = (v: unknown) => Number.isInteger(Number(v)) && Number(v) > 0;

/** The room code is printed on the room's QR, so it cannot change after creation. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const current = getRoomById(id);
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) ?? {};
  const patch: { name?: string; hourlyRate?: number; capacity?: number; imageUrl?: string | null } = {};
  if (body.name !== undefined) {
    if (!String(body.name).trim()) return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    patch.name = String(body.name);
  }
  if (body.hourlyRate !== undefined) {
    if (!positiveInt(body.hourlyRate)) return NextResponse.json({ error: "Enter an hourly rate above zero." }, { status: 400 });
    patch.hourlyRate = Number(body.hourlyRate);
  }
  if (body.capacity !== undefined) {
    if (!positiveInt(body.capacity)) return NextResponse.json({ error: "Enter how many seats the room has." }, { status: 400 });
    patch.capacity = Number(body.capacity);
  }
  if (body.imageUrl !== undefined) {
    if (body.imageUrl !== null && !isMediaUrl(body.imageUrl))
      return NextResponse.json({ error: "That image link is not valid." }, { status: 400 });
    patch.imageUrl = body.imageUrl;
  }
  updateRoom(id, patch);
  const room = getRoomById(id);
  // Uploads are files, so replacing or clearing a photo frees the old one.
  if (patch.imageUrl !== undefined && patch.imageUrl !== current.image_url) deleteImage(current.image_url);
  return NextResponse.json({ room });
}
