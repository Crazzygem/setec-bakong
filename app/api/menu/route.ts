import { NextResponse } from "next/server";
import { listMenu, createMenuItem } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const all = new URL(req.url).searchParams.get("all") !== "0";
  return NextResponse.json({ items: listMenu(all) });
}

export async function POST(req: Request) {
  const { name, price } = (await req.json().catch(() => ({}))) ?? {};
  if (!String(name ?? "").trim()) return NextResponse.json({ error: "Item name is required." }, { status: 400 });
  if (!Number.isInteger(Number(price)) || Number(price) <= 0)
    return NextResponse.json({ error: "Enter a price above zero." }, { status: 400 });
  return NextResponse.json({ item: createMenuItem({ name: String(name), price: Number(price) }) }, { status: 201 });
}
