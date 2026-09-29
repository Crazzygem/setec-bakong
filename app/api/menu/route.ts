import { NextResponse } from "next/server";
import { listMenu, createMenuItem } from "@/lib/db";
import { isMediaUrl } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const all = new URL(req.url).searchParams.get("all") !== "0";
  return NextResponse.json({ items: listMenu(all) });
}

export async function POST(req: Request) {
  const { name, price, imageUrl } = (await req.json().catch(() => ({}))) ?? {};
  if (!String(name ?? "").trim()) return NextResponse.json({ error: "Item name is required." }, { status: 400 });
  if (!Number.isInteger(Number(price)) || Number(price) <= 0)
    return NextResponse.json({ error: "Enter a price above zero." }, { status: 400 });
  if (imageUrl !== undefined && imageUrl !== null && !isMediaUrl(imageUrl))
    return NextResponse.json({ error: "That image link is not valid." }, { status: 400 });
  return NextResponse.json(
    { item: createMenuItem({ name: String(name), price: Number(price), imageUrl: imageUrl ?? null }) },
    { status: 201 }
  );
}
