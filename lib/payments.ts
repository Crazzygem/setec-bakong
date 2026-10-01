import { getSetting, settleInvoicePaid, type InvoiceRow } from "@/lib/db";
import { liveVerificationEnabled, verifyTxByMd5 } from "@/lib/bakong";

// Opt-in automatic checking (admin > Settings). Bakong's Open API allows 100 md5 checks per
// token per day, so each open QR is asked about at most once per AUTO_GAP_MS, and the whole
// thing stops for the day once Bakong answers with the quota error.
export const AUTO_GAP_MS = 30_000;
export const AUTO_CHECK_KEY = "auto_check";
export const QUOTA_ERROR_CODE = 17;

interface Throttle {
  lastCheck: Map<string, number>;
  quotaBlockedUntil: number;
}
// globalThis keeps one throttle across route bundles and dev reloads.
const g = globalThis as typeof globalThis & { __bakongThrottle?: Throttle };
const throttle: Throttle = (g.__bakongThrottle ??= { lastCheck: new Map(), quotaBlockedUntil: 0 });

/** Bakong's quota resets at midnight in Cambodia (UTC+7). */
function nextPhnomPenhMidnight(now: number): number {
  const offset = 7 * 3600_000;
  const local = new Date(now + offset);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - offset;
}

export function bakongQuotaExhausted(): boolean {
  return Date.now() < throttle.quotaBlockedUntil;
}

/** Called by anything that sees Bakong's quota error, so the rest of the app stops asking. */
export function noteQuotaExhausted(): void {
  throttle.quotaBlockedUntil = nextPhnomPenhMidnight(Date.now());
}

export function autoCheckEnabled(): boolean {
  return getSetting(AUTO_CHECK_KEY) === "1" && liveVerificationEnabled();
}

/**
 * Settles the invoice when Bakong reports it paid. Only the /check poll calls this, and only
 * while auto-check is on. `force` skips the gap for the one last look at expiry.
 */
export async function settleIfPaid(inv: InvoiceRow, { force = false } = {}): Promise<boolean> {
  if (bakongQuotaExhausted()) return false;
  const now = Date.now();
  if (!force && now - (throttle.lastCheck.get(inv.md5) ?? 0) < AUTO_GAP_MS) return false;
  throttle.lastCheck.set(inv.md5, now);

  const { paid, raw } = await verifyTxByMd5(inv.md5, { amount: inv.total, currency: inv.currency });
  if ((raw as { errorCode?: unknown })?.errorCode === QUOTA_ERROR_CODE) {
    noteQuotaExhausted();
    return false;
  }
  if (paid) {
    settleInvoicePaid(inv.id);
    throttle.lastCheck.delete(inv.md5);
  }
  return paid;
}

export function invoiceJson(inv: InvoiceRow) {
  return {
    id: inv.id,
    bookingId: inv.booking_id,
    total: inv.total,
    currency: inv.currency,
    qr: inv.qr,
    md5: inv.md5,
    status: inv.status,
    expiresAt: inv.expires_at,
    createdAt: inv.created_at,
  };
}
