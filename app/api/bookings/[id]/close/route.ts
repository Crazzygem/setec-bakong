import { NextResponse } from "next/server";
import { closeBooking, errStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    closeBooking(id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const status = errStatus(e);
    const message =
      status === 409 && e instanceof Error && e.message === "unbilled tab"
        ? "Bill the tab first"
        : status === 409 && e instanceof Error && e.message === "pending invoice"
          ? "A payment QR is still pending"
          : e instanceof Error
            ? e.message
            : "close failed";
    return NextResponse.json({ error: message }, { status });
  }
}
