import { NextResponse } from "next/server";
import { cancelBooking, errStatus, getBooking } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getBooking(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    return NextResponse.json({ ok: true, ...cancelBooking(id) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "cancel failed" }, { status: errStatus(e) });
  }
}
