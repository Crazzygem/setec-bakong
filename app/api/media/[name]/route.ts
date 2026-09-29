import { NextResponse } from "next/server";
import { readImage } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** Uploaded names carry a fresh UUID each time, so a photo can be cached forever. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  const image = readImage(name);
  if (!image) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(image.bytes), {
    headers: {
      "content-type": image.type,
      "content-length": String(image.bytes.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
