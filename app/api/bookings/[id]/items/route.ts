import { NextResponse } from "next/server";
import { addSnackItem, addExtendHours, errStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = await req.json();
    const { kind } = body ?? {};
    if (kind === "SNACK") {
      const { menuItemId, qty } = body;
      if (!menuItemId) return NextResponse.json({ error: "menuItemId required" }, { status: 400 });
      const row = addSnackItem(id, String(menuItemId), Number(qty));
      return NextResponse.json({ item: row }, { status: 201 });
    }
    if (kind === "ROOM_HOURS") {
      const { hours } = body;
      const row = addExtendHours(id, Number(hours));
      return NextResponse.json({ item: row }, { status: 201 });
    }
    return NextResponse.json({ error: 'kind must be "SNACK" or "ROOM_HOURS"' }, { status: 400 });
  } catch (e: unknown) {
    const status = errStatus(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "add item failed" }, { status });
  }
}
