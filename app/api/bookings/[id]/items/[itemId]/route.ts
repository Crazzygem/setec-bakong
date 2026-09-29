import { NextResponse } from "next/server";
import { removeTabItem, errStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Staff correcting a mistake at the counter. The guest's own page is read-only. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await ctx.params;
  try {
    return NextResponse.json({ item: removeTabItem(id, itemId) });
  } catch (e: unknown) {
    const status = errStatus(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "remove failed" }, { status });
  }
}
