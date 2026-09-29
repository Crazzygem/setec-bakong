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

/** A riel price is always a whole 100 riel, never an odd amount. */
export const KHR_STEP = 100;

/** What the guest is charged when a tab is billed in `to`. */
export interface BillConversion {
  /** Minor units in `to`, what the invoice total must be. */
  total: number;
  /** The tab total in `to` before rounding, so the UI can show where the difference came from. */
  exact: number;
  /** true when the price was rounded up to a payable amount. */
  rounded: boolean;
}

/**
 * Converts a tab total into the currency the guest is paying in, rounding the price UP so
 * the shop is never short and the guest is never charged less than the rate. A riel price
 * is a whole 100, so a dollar bill lands on a 100 riel step: $0.83 is 3,320 riel, charged
 * as 3,400. The other way, one cent is 40 riel, so a riel tab does not always divide into
 * cents: ៛300 is 7.5 cents, charged as 8. Unlike convertMinor there is no inflation floor,
 * because a small tab billed in dollars must not be turned into a bigger bill.
 */
export function toBillAmount(minor: number, from: Currency, to: Currency): BillConversion {
  if (from === to) return { total: minor, exact: minorToMajor(minor, from), rounded: false };
  if (to === "USD") {
    const exact = (minor / KHR_PER_USD) * 100;
    // The epsilon keeps an exact figure like 3300 from floating to 3300.0000000000005 and
    // then rounding up a whole cent.
    const total = Math.max(1, Math.ceil(exact - 1e-9));
    return { total, exact, rounded: total !== exact };
  }
  const exact = (minor / 100) * KHR_PER_USD;
  const total = Math.max(KHR_STEP, Math.ceil(exact / KHR_STEP - 1e-9) * KHR_STEP);
  return { total, exact, rounded: total !== exact };
}

export function moneyInputAttrs(currency: Currency): { step: string; min: string; prefix: string } {
  return currency === "USD" ? { step: "0.01", min: "0.01", prefix: "$" } : { step: "100", min: "100", prefix: "៛" };
}
