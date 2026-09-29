import { isCurrency, type Currency } from "@/lib/money";

/**
 * The currency every new price and KHQR uses. Must match what the receiving
 * bank account can accept: a USD-only account rejects a KHR QR at account inquiry.
 */
export function shopCurrency(): Currency {
  const v = process.env.SHOP_CURRENCY?.toUpperCase();
  return isCurrency(v) ? v : "KHR";
}
