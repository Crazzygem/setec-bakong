import { NextResponse } from "next/server";
import { setSetting } from "@/lib/db";
import { liveVerificationEnabled } from "@/lib/bakong";
import { AUTO_CHECK_KEY, AUTO_GAP_MS, autoCheckEnabled, bakongQuotaExhausted } from "@/lib/payments";

export const dynamic = "force-dynamic";

function state() {
  return {
    autoCheck: autoCheckEnabled(),
    tokenSet: liveVerificationEnabled(),
    quotaBlocked: bakongQuotaExhausted(),
    gapSeconds: AUTO_GAP_MS / 1000,
  };
}

export async function GET() {
  return NextResponse.json(state());
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { autoCheck?: unknown };
  if (typeof body.autoCheck !== "boolean") return NextResponse.json({ error: "autoCheck must be true or false" }, { status: 400 });
  if (body.autoCheck && !liveVerificationEnabled())
    return NextResponse.json({ error: "Set BAKONG_TOKEN first. Automatic checks need it." }, { status: 409 });
  setSetting(AUTO_CHECK_KEY, body.autoCheck ? "1" : "0");
  return NextResponse.json(state());
}
