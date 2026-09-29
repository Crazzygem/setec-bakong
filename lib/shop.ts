import { isCurrency, type Currency } from "@/lib/money";

/**
 * The currency every new price and KHQR uses. Must match what the receiving
 * bank account can accept: a USD-only account rejects a KHR QR at account inquiry.
 */
export function shopCurrency(): Currency {
  const v = process.env.SHOP_CURRENCY?.toUpperCase();
  return isCurrency(v) ? v : "KHR";
}

/**
 * MERCHANT_KHQR_CURRENCIES, e.g. "KHR,USD", for accounts with no bank marker in the QR. A
 * Bakong wallet holds both currencies and the bill's tag 53 picks one, but its QR only names KHR.
 */
export function declaredCurrencies(): Currency[] | null {
  const list = process.env.MERCHANT_KHQR_CURRENCIES?.toUpperCase().split(",").map((c) => c.trim()).filter(isCurrency);
  return list?.length ? list : null;
}

/**
 * Reports what the settlement account can accept, at boot. A dual-currency account
 * (ACLEDA tag 39 "2CCY") takes a bill in either currency. A single-currency account
 * fails the other currency at the bank's account inquiry, which presents as a QR that
 * will not scan rather than as a currency mismatch.
 */
export function describeSettlement(): string {
  const source = process.env.MERCHANT_KHQR_SOURCE?.trim();
  if (!source) return "[khqr] no MERCHANT_KHQR_SOURCE, building QRs from the MERCHANT_ fields";
  const declared = declaredCurrencies();
  if (declared) return `[khqr] MERCHANT_KHQR_CURRENCIES is ${declared.join(", ")}, bills can be charged in those`;
  if (source.includes("2CCY")) return "[khqr] MERCHANT_KHQR_SOURCE is 2CCY, bills can be charged in KHR or USD";
  const usd = source.includes("5303840");
  const single = usd ? "USD" : "KHR";
  return `[khqr] MERCHANT_KHQR_SOURCE is single-currency (${single}), bills can only be charged in ${single}`;
}
