"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateKHQRSVG, svgToDataURI } from "@manethpak/khqr-sdk/svg";
import { formatMoney, type Currency } from "@/lib/money";
import { Button } from "@/components/ui";

export type InvoiceStatus = "PENDING" | "PAID" | "EXPIRED";

interface Invoice {
  id: string;
  total: number;
  currency: Currency;
  qr: string;
  md5: string;
  status: InvoiceStatus;
  expiresAt: number;
}

const POLL_MS = 3000;

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Bank apps scan from the photo gallery, which takes PNG, not the SVG we render. */
async function savePng(svgDataUri: string, filename: string) {
  const img = new Image();
  img.src = svgDataUri;
  await img.decode();
  const scale = 3;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth * scale;
  canvas.height = img.naturalHeight * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename;
  a.click();
}

/**
 * One dynamic KHQR invoice: shows the QR, counts down, and polls /check (local status,
 * no Bakong call) until staff approve the payment or it expires. Key it by invoiceId so
 * timers reset.
 */
export function KhqrPayment({
  invoiceId,
  onSettled,
  onCancel,
  showSave = false,
  canApprove = false,
}: {
  invoiceId: string;
  onSettled?: (status: Exclude<InvoiceStatus, "PENDING">) => void;
  onCancel?: () => void;
  /** For a customer paying on the same phone that shows the QR. */
  showSave?: boolean;
  /** Staff only: shows the button that confirms the money arrived. */
  canApprove?: boolean;
}) {
  const [inv, setInv] = useState<Invoice | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const settledRef = useRef(onSettled);
  const firedRef = useRef(false);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);

  const applyStatus = useCallback((status: InvoiceStatus) => {
    setInv((cur) => (cur && cur.status !== status ? { ...cur, status } : cur));
    if (status !== "PENDING" && !firedRef.current) {
      firedRef.current = true;
      settledRef.current?.(status);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`);
      if (!res.ok) {
        setError(res.status === 404 ? "This payment could not be found." : "Could not load this payment. Refresh to try again.");
        return;
      }
      const data = await res.json();
      setInv(data.invoice);
      applyStatus(data.invoice.status);
    } catch {
      setError("No connection to the server. Check the network and refresh.");
    }
  }, [invoiceId, applyStatus]);

  useEffect(() => {
    load();
  }, [load]);

  const pending = inv?.status === "PENDING";

  useEffect(() => {
    if (!pending) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/check`).catch(() => null);
      if (!res?.ok) return;
      const data = await res.json();
      applyStatus(data.status);
    }, POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [pending, invoiceId, applyStatus]);

  const qrImg = useMemo(() => {
    if (!inv) return null;
    try {
      const rendered = generateKHQRSVG(inv.qr);
      return rendered.result ? svgToDataURI(rendered.result) : null;
    } catch {
      return null;
    }
  }, [inv]);

  async function post(path: "approve" | "verify" | "cancel") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/${path}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That did not work. Try again.");
        return;
      }
      if (path === "verify" && !data.paid) {
        setNotice("Bakong has no payment for this QR yet. Try again in a moment.");
        return;
      }
      applyStatus(data.status);
      if (path === "cancel" && data.status === "EXPIRED") onCancel?.();
    } finally {
      setBusy(false);
    }
  }

  if (error && !inv) return <p className="py-6 text-center text-sm text-error">{error}</p>;
  if (!inv) return <p className="py-10 text-center text-sm text-muted">Preparing the KHQR…</p>;

  const amount = formatMoney(inv.total, inv.currency);
  const ref = inv.md5.slice(0, 8).toUpperCase();

  if (inv.status === "PAID")
    return (
      <div className="py-6 text-center" role="status">
        <svg aria-hidden viewBox="0 0 48 48" className="mx-auto h-12 w-12">
          <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeWidth="3" />
          <path d="M14 25l7 7 13-15" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="mt-3 text-lg font-semibold">Paid {amount}</p>
        <p className="mt-1 text-sm text-muted">
          Reference <span className="font-medium text-ink tabular-nums">{ref}</span>
        </p>
      </div>
    );

  if (inv.status === "EXPIRED")
    return (
      <div className="py-6 text-center" role="status">
        <p className="text-lg font-semibold">This QR has closed</p>
        <p className="mt-1 text-sm text-muted">No payment of {amount} arrived. Make a new QR to try again.</p>
      </div>
    );

  const left = inv.expiresAt - now;

  return (
    <div className="flex flex-col items-center">
      <p className="text-[28px] font-bold leading-tight tabular-nums">{amount}</p>
      {qrImg ? (
        <img src={qrImg} alt={`KHQR code for ${amount}`} className="mt-4 w-full max-w-[280px]" />
      ) : (
        <p className="mt-4 font-mono text-xs break-all">{inv.qr}</p>
      )}
      <p className="mt-4 text-center text-sm text-body">
        Scan with any Cambodian bank app. Closes in{" "}
        <span className={`font-semibold tabular-nums ${left < 60_000 ? "text-error" : "text-ink"}`}>{mmss(left)}</span>
      </p>
      {!canApprove && (
        <p className="mt-1 text-center text-sm text-muted">This screen updates once the shop confirms your payment.</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-center text-sm text-muted">
          {notice}
        </p>
      )}
      <div className="mt-5 flex w-full max-w-[320px] flex-col gap-2">
        {showSave && qrImg && (
          <Button variant="secondary" onClick={() => savePng(qrImg, `khqr-${ref}.png`)}>
            Save QR image
          </Button>
        )}
        {showSave && (
          <p className="text-center text-sm text-muted">On this phone? Save the image, then pick it from your bank app&apos;s scan screen.</p>
        )}
        {onCancel && (
          <Button variant="secondary" onClick={() => post("cancel")} disabled={busy}>
            Cancel this QR
          </Button>
        )}
        {canApprove && (
          <Button onClick={() => post("verify")} disabled={busy}>
            Check payment with Bakong
          </Button>
        )}
        {canApprove && (
          <Button
            variant="secondary"
            onClick={() => {
              if (window.confirm(`Confirm you received ${amount} in the Bakong app?`)) post("approve");
            }}
            disabled={busy}
          >
            Confirm payment received
          </Button>
        )}
      </div>
    </div>
  );
}
