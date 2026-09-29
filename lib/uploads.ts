import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Photos are files, not blobs. They sit beside the SQLite file so redeploying
 * the app directory cannot drop them, and are served back through /api/media.
 */

const MAX_BYTES = 4 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MIME_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([mime, ext]) => [ext, mime]),
);

/** Only names we generated ourselves may be read or deleted, so no path can escape the directory. */
const STORED_NAME = new RegExp(
  `^[0-9a-f-]{36}\\.(${Object.keys(MIME_BY_EXTENSION).join("|")})$`,
);

export function uploadDir(): string {
  return join(dirname(process.env.DATABASE_PATH ?? "./data/app.db"), "uploads");
}

export function mediaUrl(name: string): string {
  return `/api/media/${name}`;
}

/** Guards image_url coming from a request body: only our own media paths are allowed. */
export function isMediaUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\/api\/media\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(value)
  );
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function saveImage(bytes: Buffer, type: string): string {
  const extension = EXTENSIONS[type.toLowerCase()];
  if (!extension)
    throw new UploadError("Use a JPEG, PNG, WebP or GIF image.", 415);
  if (bytes.byteLength === 0) throw new UploadError("That file is empty.", 400);
  if (bytes.byteLength > MAX_BYTES)
    throw new UploadError("Images must be 4 MB or smaller.", 413);

  const dir = uploadDir();
  mkdirSync(dir, { recursive: true });
  const name = `${randomUUID()}.${extension}`;
  writeFileSync(join(dir, name), bytes);
  return mediaUrl(name);
}

export function readImage(
  name: string,
): { bytes: Buffer; type: string } | null {
  const extension = name.split(".").pop() ?? "";
  if (!STORED_NAME.test(name)) return null;
  try {
    return {
      bytes: readFileSync(join(uploadDir(), name)),
      type: MIME_BY_EXTENSION[extension],
    };
  } catch {
    return null;
  }
}

export function deleteImage(url: string | null | undefined): void {
  const name = url?.startsWith("/api/media/")
    ? url.slice("/api/media/".length)
    : "";
  if (!STORED_NAME.test(name)) return;
  try {
    unlinkSync(join(uploadDir(), name));
  } catch {
    // Already gone; the row no longer points at it either way.
  }
}
