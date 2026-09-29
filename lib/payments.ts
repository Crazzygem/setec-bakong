import type { InvoiceRow } from "@/lib/db";

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
