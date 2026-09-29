import { settleInvoicePaid, type InvoiceRow } from "@/lib/db";
import { liveVerificationEnabled, verifyTxByMd5 } from "@/lib/bakong";

// Bakong's Open API allows 100 md5 checks per token per day. Screens poll every few
// seconds, so the server spaces real checks per invoice and stops once the quota is gone.
const MIN_GAP_MS = 15_000;
const QUOTA_ERROR_CODE = 17;

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

/**
 * Settles the invoice when Bakong reports it paid. Routine polls are spaced MIN_GAP_MS apart
 * per invoice; `force` is for one-off decisions (cancel, expiry, re-bill) that must ask now.
 */
export async function settleIfPaid(inv: InvoiceRow, { force = false } = {}): Promise<boolean> {
  if (!liveVerificationEnabled() || bakongQuotaExhausted()) return false;
  const now = Date.now();
  if (!force && now - (throttle.lastCheck.get(inv.md5) ?? 0) < MIN_GAP_MS) return false;
  throttle.lastCheck.set(inv.md5, now);

  const { paid, raw } = await verifyTxByMd5(inv.md5, { amount: inv.total, currency: inv.currency });
  if ((raw as { errorCode?: unknown })?.errorCode === QUOTA_ERROR_CODE) {
    throttle.quotaBlockedUntil = nextPhnomPenhMidnight(now);
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
