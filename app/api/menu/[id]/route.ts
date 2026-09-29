import { NextResponse } from "next/server";
import { getMenuItem, updateMenuItem } from "@/lib/db";
import { deleteImage, isMediaUrl } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const current = getMenuItem(id);
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) ?? {};
  const patch: { name?: string; price?: number; available?: boolean; imageUrl?: string | null } = {};
  if (body.name !== undefined) {
    if (!String(body.name).trim()) return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    patch.name = String(body.name);
  }
  if (body.price !== undefined) {
    if (!Number.isInteger(Number(body.price)) || Number(body.price) <= 0)
      return NextResponse.json({ error: "Enter a price above zero." }, { status: 400 });
    patch.price = Number(body.price);
  }
  if (body.available !== undefined) patch.available = !!body.available;
  if (body.imageUrl !== undefined) {
    if (body.imageUrl !== null && !isMediaUrl(body.imageUrl))
      return NextResponse.json({ error: "That image link is not valid." }, { status: 400 });
    patch.imageUrl = body.imageUrl;
  }
  updateMenuItem(id, patch);
  const item = getMenuItem(id);
  if (patch.imageUrl !== undefined && patch.imageUrl !== current.image_url) deleteImage(current.image_url);
  return NextResponse.json({ item });
}
