// Amounts are stored as integers in the currency's minor unit: US cents, or whole riel.

export type Currency = "USD" | "KHR";

const DIGITS: Record<Currency, number> = { USD: 2, KHR: 0 };

/** Only used to convert prices when SHOP_CURRENCY changes; never for a live payment. */
export const KHR_PER_USD = 4000;

export function isCurrency(v: unknown): v is Currency {
  return v === "USD" || v === "KHR";
}

export function minorToMajor(minor: number, currency: Currency): number {
  const d = DIGITS[currency];
  // toFixed keeps float noise (0.30000000000000004) out of the KHQR amount tag.
  return Number((minor / 10 ** d).toFixed(d));
}

export function majorToMinor(major: number, currency: Currency): number {
  return Math.round(major * 10 ** DIGITS[currency]);
}

export function formatMoney(minor: number, currency: Currency): string {
  if (currency === "KHR") return `៛${minor.toLocaleString("en-US")}`;
  return minorToMajor(minor, "USD").toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Parses what a person typed ("1.5", "1,500") into minor units; null when not a positive amount. */
export function parseMoneyInput(input: string, currency: Currency): number | null {
  const n = Number(input.replace(/[,\s$៛]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const minor = majorToMinor(n, currency);
  return minor > 0 ? minor : null;
}

export function convertMinor(minor: number, from: Currency, to: Currency): number {
  if (from === to) return minor;
  if (from === "KHR") return Math.max(1, Math.round((minor / KHR_PER_USD) * 100));
  return Math.max(100, Math.round(((minor / 100) * KHR_PER_USD) / 100) * 100);
}

/** What the guest is charged when a tab is billed in `to`. */
export interface BillConversion {
  /** Minor units in `to`, what the invoice total must be. */
  total: number;
  /** The tab total in `to` before rounding, so the UI can show where the difference came from. */
  exact: number;
  /** true when `to` had fewer minor units and the total was rounded to a payable amount. */
  rounded: boolean;
}

/**
 * Converts a tab total into the currency the guest is paying in. One cent is 40 riel,
 * so a riel total only divides exactly into dollars when it is a multiple of 40; the
 * nearest cent is off by at most 20 riel. Unlike convertMinor there is no minimum,
 * because a small tab billed in dollars must not be inflated into a bigger bill.
 */
export function toBillAmount(minor: number, from: Currency, to: Currency): BillConversion {
  if (from === to) return { total: minor, exact: minorToMajor(minor, from), rounded: false };
  if (to === "USD") {
    const exact = (minor / KHR_PER_USD) * 100;
    const total = Math.max(1, Math.round(exact));
    return { total, exact, rounded: total !== exact };
  }
  const exact = (minor / 100) * KHR_PER_USD;
  const total = Math.max(1, Math.round(exact));
  return { total, exact, rounded: total !== exact };
}

export function moneyInputAttrs(currency: Currency): { step: string; min: string; prefix: string } {
  return currency === "USD" ? { step: "0.01", min: "0.01", prefix: "$" } : { step: "100", min: "100", prefix: "៛" };
}
