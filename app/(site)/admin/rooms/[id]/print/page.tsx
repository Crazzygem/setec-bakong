import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import QRCode from "qrcode";
import { getRoomById } from "@/lib/db";
import PrintButton from "./print-button";

export const dynamic = "force-dynamic";

/**
 * APP_URL pins the QR to one address. Without it we follow the request, so the
 * same build prints correct codes on an IP today and on a domain once DNS lands.
 */
async function publicBase(): Promise<string> {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "http://localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return `${proto}://${host}`;
}

export default async function PrintRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const room = getRoomById(id);
  if (!room) notFound();
  const base = await publicBase();
  const url = `${base}/t/${room.code}`;
  const img = await QRCode.toDataURL(url, { width: 512, margin: 2 });

  return (
    <div className="mx-auto max-w-md px-4 py-8 md:py-12">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/admin"
          className="flex min-h-11 items-center text-sm font-medium underline"
        >
          Back to Admin
        </Link>
        <PrintButton />
      </div>
      <div className="rounded-md border border-ink p-8 text-center">
        <p className="text-sm text-muted">{room.name}</p>
        <p className="mt-1 text-[64px] leading-none font-bold tracking-tight">
          {room.code}
        </p>
        <img
          src={img}
          alt={`QR code that opens ${url}`}
          className="mx-auto mt-6 h-60 w-60"
        />
        <p className="mt-6 text-lg font-semibold">
          Scan to order snacks, add time and pay
        </p>
        <p className="mt-2 text-sm text-muted break-all">{url}</p>
      </div>
      {!process.env.APP_URL?.trim() && (
        <p className="no-print mt-4 text-sm text-muted">
          APP_URL is not set, so this QR uses the address you loaded this page
          from. Set APP_URL to pin printed codes to one domain.
        </p>
      )}
    </div>
  );
}
