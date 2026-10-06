"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

export function PaymentLoading({ staff = false }: { staff?: boolean }) {
  return (
    <div role="status" aria-busy="true" className={`payment-enter flex flex-1 flex-col ${staff ? "p-5 md:p-6" : "items-center py-6"}`}>
      <p className="text-lg font-semibold">Generating payment QR…</p>
      <p className="mt-1 text-sm text-muted">Preparing your payment request.</p>
      <div aria-hidden="true" className="payment-skeleton mx-auto mt-6 flex aspect-square w-full max-w-[280px] items-center justify-center rounded-md bg-surface-soft">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" className="h-16 w-16 text-field">
          <rect x="7" y="7" width="12" height="12" rx="1" />
          <rect x="29" y="7" width="12" height="12" rx="1" />
          <rect x="7" y="29" width="12" height="12" rx="1" />
          <path d="M29 29h6v6h6M29 41h6M41 29v-5M24 7v12M7 24h12" />
        </svg>
      </div>
    </div>
  );
}

function PaymentSuccess({ amount, reference, staff }: { amount: string; reference: string; staff: boolean }) {
  return (
    <div role="status" className={`payment-enter ${staff ? "flex items-center gap-4" : "py-6 text-center"}`}>
      <svg aria-hidden="true" viewBox="0 0 48 48" className={`payment-success h-12 w-12 shrink-0 ${staff ? "" : "mx-auto"}`}>
        <circle className="payment-success-ring" cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeWidth="3" pathLength="1" />
        <path className="payment-success-check" d="M14 25l7 7 13-15" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
      </svg>
      <div className={staff ? "" : "mt-3"}>
        <p className="text-lg font-semibold">Payment confirmed</p>
        <p className="mt-1 text-[28px] font-bold leading-tight tabular-nums">{amount}</p>
        <p className="mt-2 text-sm text-muted">
          Reference <span className="font-medium text-ink tabular-nums">{reference}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * One dynamic KHQR invoice: shows the QR, counts down, and polls /check until staff confirm
 * the payment, auto-check finds it, or it expires. Key it by invoiceId so timers reset.
 *
 * The guest version is a centered column. The staff version fills its panel: content on top,
 * actions in a footer under a rule, the same shape as the bill panel it replaces.
 */
export function KhqrPayment({
  invoiceId,
  onSettled,
  onCancel,
  showSave = false,
  staff = false,
  settledFooter,
}: {
  invoiceId: string;
  onSettled?: (status: Exclude<InvoiceStatus, "PENDING">) => void;
  onCancel?: () => void;
  /** For a customer paying on the same phone that shows the QR. */
  showSave?: boolean;
  /** Staff panel: left-aligned layout with the check, confirm and cancel actions. */
  staff?: boolean;
  /** Staff panel: actions shown once the invoice is paid or closed. */
  settledFooter?: ReactNode;
}) {
  const [inv, setInv] = useState<Invoice | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"approve" | "verify" | "cancel" | null>(null);
  const busy = action !== null;
  const [notice, setNotice] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [quotaBlocked, setQuotaBlocked] = useState(false);
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
      setAuto(!!data.auto);
      setQuotaBlocked(!!data.quotaBlocked);
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
      setAuto(!!data.auto);
      setQuotaBlocked(!!data.quotaBlocked);
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
    setAction(path);
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
        setNotice("Payment not yet verified. Try again shortly.");
        return;
      }
      applyStatus(data.status);
      if (path === "cancel" && data.status === "EXPIRED") onCancel?.();
    } catch {
      setError("Unable to complete this action. Check your connection and try again.");
    } finally {
      setAction(null);
    }
  }

  if (error && !inv) return <p className="py-6 text-center text-sm text-error">{error}</p>;
  if (!inv) return <PaymentLoading staff={staff} />;

  const amount = formatMoney(inv.total, inv.currency);
  const ref = inv.md5.slice(0, 8).toUpperCase();

  const left = inv.expiresAt - now;

  if (staff) {
    const confirm = () => {
      if (window.confirm(`Mark this bill as paid? Confirm that you received ${amount} in your banking app before continuing.`)) post("approve");
    };
    const settled = inv.status !== "PENDING";
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 p-5 md:p-6 lg:overflow-y-auto">
          {inv.status === "PAID" && (
            <PaymentSuccess amount={amount} reference={ref} staff />
          )}
          {inv.status === "EXPIRED" && (
            <div role="status" className="payment-enter">
              <p className="text-lg font-semibold">Payment request expired</p>
              <p className="mt-1 text-sm text-muted">Verify receipt before generating a new QR.</p>
            </div>
          )}
          {!settled && (
            <div className="payment-enter">
              <h2 className="text-[21px] font-bold">Payment request</h2>
              <p role="status" className="mt-1 text-sm text-muted">Awaiting payment</p>
              <p className="mt-5 text-sm font-medium text-muted">Amount due</p>
              <div className="mt-1 flex items-baseline justify-between gap-4">
                <p className="text-[28px] font-bold leading-tight tabular-nums">{amount}</p>
                <p className="shrink-0 text-sm text-muted">
                  Expires in{" "}
                  <span className={`font-semibold tabular-nums ${left < 60_000 ? "text-error" : "text-ink"}`}>{mmss(left)}</span>
                </p>
              </div>
              {qrImg ? (
                <img src={qrImg} alt={`KHQR code for ${amount}`} className="payment-qr-enter mx-auto mt-5 w-full max-w-[280px]" />
              ) : (
                <p className="mt-5 font-mono text-xs break-all">{inv.qr}</p>
              )}
              {error && (
                <p role="alert" className="mt-4 text-sm text-error">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="mt-4 text-sm text-muted">
                  {notice}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="space-y-2 border-t border-hairline p-5 md:p-6">
          {settled ? (
            settledFooter
          ) : (
            <>
              {auto ? (
                <p role="status" className="pb-1 text-sm text-muted">
                  {quotaBlocked
                    ? "Automatic verification is unavailable. Confirm receipt in your banking app before marking this bill as paid."
                    : "Verifying payment automatically…"}
                </p>
              ) : (
                <Button className="w-full" onClick={() => post("verify")} disabled={busy}>
                  {action === "verify" ? "Verifying…" : "Verify payment"}
                </Button>
              )}
              <Button className="w-full" variant={auto && quotaBlocked ? "primary" : "secondary"} onClick={confirm} disabled={busy}>
                {action === "approve" ? "Recording payment…" : "Mark as paid"}
              </Button>
              <p className="text-center text-xs text-muted">Use only after confirming receipt in your banking app.</p>
              {onCancel && (
                <Button className="w-full" variant="tertiary" size="sm" onClick={() => post("cancel")} disabled={busy}>
                  {action === "cancel" ? "Cancelling…" : "Cancel payment request"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (inv.status === "PAID")
    return <PaymentSuccess amount={amount} reference={ref} staff={false} />;

  if (inv.status === "EXPIRED")
    return (
      <div className="py-6 text-center" role="status">
        <p className="text-lg font-semibold">Payment request expired</p>
        <p className="mt-1 text-sm text-muted">This QR is no longer active. Ask staff for a new payment request.</p>
      </div>
    );

  return (
    <div className="payment-enter flex flex-col items-center">
      <p className="text-[28px] font-bold leading-tight tabular-nums">{amount}</p>
      {qrImg ? (
        <img src={qrImg} alt={`KHQR code for ${amount}`} className="payment-qr-enter mt-4 w-full max-w-[280px]" />
      ) : (
        <p className="mt-4 font-mono text-xs break-all">{inv.qr}</p>
      )}
      <p className="mt-4 text-center text-sm text-body">
        Scan with any Cambodian bank app. Expires in{" "}
        <span className={`font-semibold tabular-nums ${left < 60_000 ? "text-error" : "text-ink"}`}>{mmss(left)}</span>
      </p>
      <p className="mt-1 text-center text-sm text-muted">Your payment status updates here once confirmed.</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      )}
      {showSave && (
        <div className="mt-5 flex w-full max-w-[320px] flex-col gap-2">
          {qrImg && (
            <Button variant="secondary" onClick={() => savePng(qrImg, `khqr-${ref}.png`)}>
              Download QR image
            </Button>
          )}
          <p className="text-center text-sm text-muted">Paying on this device? Download the QR image and select it in your banking app.</p>
        </div>
      )}
    </div>
  );
}
