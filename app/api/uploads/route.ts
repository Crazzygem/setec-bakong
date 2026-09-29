import { NextResponse } from "next/server";
import { saveImage, UploadError } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File))
    return NextResponse.json(
      { error: "Choose an image to upload." },
      { status: 400 },
    );
  if (file.size > 4 * 1024 * 1024)
    return NextResponse.json(
      { error: "Images must be 4 MB or smaller." },
      { status: 413 },
    );
  try {
    const imageUrl = saveImage(
      Buffer.from(await file.arrayBuffer()),
      file.type,
    );
    return NextResponse.json({ imageUrl }, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof UploadError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json(
      { error: "That image could not be saved." },
      { status: 500 },
    );
  }
}
