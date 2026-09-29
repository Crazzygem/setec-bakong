import { createKHQR } from "@manethpak/khqr-sdk";
// QR generation uses NBC's official SDK: the community SDK writes tag-99 timestamps in
// seconds, which strict bank apps reject. The community client is kept for the Open API only.
import { BakongKHQR, IndividualInfo, MerchantInfo, khqrData } from "bakong-khqr";
import { dynamicFromStatic, parseTlv } from "@/lib/emv";
import { majorToMinor, minorToMajor, type Currency } from "@/lib/money";
import { declaredCurrencies, shopCurrency } from "@/lib/shop";

export interface QRResult {
  qr: string;
  md5: string;
}

export interface QRGenResult {
  result: QRResult | null;
  error: { code: string; message: string } | null;
}

let khqr: ReturnType<typeof createKHQR> | null = null;

/** Server-only. Never import this module from client components. */
export function getKhqr() {
  if (!khqr) {
    khqr = createKHQR({
      baseURL: process.env.BAKONG_BASE_URL ?? "https://api-bakong.nbc.gov.kh",
      authToken: process.env.BAKONG_TOKEN ?? "",
    });
  }
  return khqr;
}

/**
 * "individual" writes the account under tag 29, "merchant" under tag 30. Both carry a
 * Bakong ID, an account (tag 29) or merchant ID (tag 30), and the acquiring bank; a bank's
 * account inquiry fails when the layout does not match how that bank registered the account.
 */
export type KhqrLayout = "individual" | "merchant";

export interface KhqrOptions {
  layout?: KhqrLayout;
  /** Sub-tag 00, e.g. "name@aclb", or a shared ID such as "khqr@aclb" with an account behind it. */
  bakongId: string;
  /** Sub-tag 01: account number (individual) or merchant ID (merchant). */
  accountInformation?: string;
  /** Sub-tag 02: acquiring bank name. Required by the merchant layout. */
  acquiringBank?: string;
  merchantName?: string;
  merchantCity?: string;
  merchantCategoryCode?: string;
  mobileNumber?: string;
  storeLabel?: string;
  terminalLabel?: string;
  currency: Currency;
  /** Minor units. Omit for a static QR (PoIM 11); set for a dynamic one (PoIM 12). */
  amount?: number;
  billNumber?: string;
  expiresInMs?: number;
}

export function merchantKhqrDefaults(): Pick<KhqrOptions, "layout" | "bakongId" | "accountInformation" | "acquiringBank"> {
  return {
    layout: process.env.MERCHANT_KHQR_LAYOUT === "merchant" ? "merchant" : "individual",
    bakongId: process.env.MERCHANT_BAKONG_ID ?? "",
    accountInformation: process.env.MERCHANT_ACCOUNT_INFO || undefined,
    acquiringBank: process.env.MERCHANT_ACQUIRING_BANK || undefined,
  };
}

export const INVOICE_TTL_MS = 5 * 60 * 1000;

export function buildKhqr(o: KhqrOptions): QRGenResult {
  const dynamic = o.amount !== undefined;
  const name = o.merchantName ?? process.env.MERCHANT_NAME ?? "SETEC Showcase";
  const city = o.merchantCity ?? process.env.MERCHANT_CITY ?? "Phnom Penh";
  const optional = {
    ...(o.layout !== "merchant" && o.accountInformation ? { accountInformation: o.accountInformation } : {}),
    ...(o.layout !== "merchant" && o.acquiringBank ? { acquiringBank: o.acquiringBank } : {}),
    ...(o.merchantCategoryCode ? { merchantCategoryCode: o.merchantCategoryCode } : {}),
    ...(o.mobileNumber ? { mobileNumber: o.mobileNumber } : {}),
    ...(o.storeLabel ? { storeLabel: o.storeLabel } : {}),
    ...(o.terminalLabel ? { terminalLabel: o.terminalLabel } : {}),
    currency: o.currency === "USD" ? khqrData.currency.usd : khqrData.currency.khr,
    ...(dynamic
      ? {
          amount: minorToMajor(o.amount!, o.currency),
          expirationTimestamp: String(Date.now() + (o.expiresInMs ?? INVOICE_TTL_MS)),
        }
      : {}),
    // Bank apps have rejected bill numbers with punctuation; keep them alphanumeric.
    ...(o.billNumber ? { billNumber: o.billNumber.replace(/[^A-Za-z0-9]/g, "") } : {}),
  };
  if (o.layout === "merchant" && (!o.accountInformation || !o.acquiringBank)) {
    return { result: null, error: { code: "LAYOUT", message: "The merchant layout needs a merchant ID and an acquiring bank." } };
  }
  const res =
    o.layout === "merchant"
      ? new BakongKHQR().generateMerchant(new MerchantInfo(o.bakongId, name, city, o.accountInformation!, o.acquiringBank!, optional))
      : new BakongKHQR().generateIndividual(new IndividualInfo(o.bakongId, name, city, optional));
  if (res?.status?.code !== 0 || !res?.data) {
    return {
      result: null,
      error: { code: String(res?.status?.code ?? "UNKNOWN"), message: res?.status?.message ?? "QR generation failed" },
    };
  }
  return { result: { qr: res.data.qr, md5: res.data.md5 }, error: null };
}

/** A bill built on the bank's own static QR, so every account tag the bank routes on is exact. */
export function khqrFromSource(
  source: string,
  o: { currency: Currency; amount: number; billNumber: string; expiresInMs?: number }
): QRGenResult {
  try {
    const expiresAt = Date.now() + (o.expiresInMs ?? INVOICE_TTL_MS);
    const result = dynamicFromStatic(source, { ...o, expiresAt });
    if (!BakongKHQR.verify(result.qr)?.isValid) throw new Error("The rebuilt QR failed NBC's KHQR check");
    return { result, error: null };
  } catch (e) {
    return { result: null, error: { code: "SOURCE", message: e instanceof Error ? e.message : String(e) } };
  }
}

export function generateInvoiceQR(input: {
  invoiceId: string;
  amount: number;
  /** The currency the guest is paying in. Staff choose it; it defaults to the shop currency. */
  currency?: Currency;
}): QRGenResult & { currency: Currency } {
  const currency = input.currency ?? shopCurrency();
  // MERCHANT_KHQR_SOURCE is the bank app's receive-money QR text; it wins over the separate fields.
  const source = process.env.MERCHANT_KHQR_SOURCE?.trim();
  if (source) return { currency, ...khqrFromSource(source, { currency, amount: input.amount, billNumber: input.invoiceId }) };
  return {
    currency,
    ...buildKhqr({ ...merchantKhqrDefaults(), currency, amount: input.amount, billNumber: input.invoiceId }),
  };
}

/**
 * ACLEDA marks a dual-currency account with tag 39 "2CCY", and the bank then routes by
 * whatever currency the customer pays in. Such an account accepts both. A source without
 * 2CCY is single-currency, and a bill in the other currency produces a QR the bank app
 * rejects at account inquiry, which looks like a scan failure rather than a mismatch.
 */
export function sourceAcceptsCurrency(source: string, currency: Currency): boolean {
  if (declaredCurrencies()?.includes(currency)) return true;
  try {
    const dual = parseTlv(source).some(([t, v]) => t === "39" && v.includes("2CCY"));
    if (dual) return true;
    const code = parseTlv(source).find(([t]) => t === "53")?.[1];
    return (code === "840" && currency === "USD") || (code === "116" && currency === "KHR");
  } catch {
    return false;
  }
}

export function decodeKhqr(qr: string): { valid: boolean; fields: Record<string, unknown> } {
  const valid = !!BakongKHQR.verify(qr)?.isValid;
  const data = (BakongKHQR.decode(qr)?.data ?? {}) as Record<string, unknown>;
  const fields = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== ""));
  return { valid, fields };
}

function txCurrency(v: unknown): Currency | null {
  const s = String(v ?? "").toUpperCase();
  if (s === "USD" || s === "840") return "USD";
  if (s === "KHR" || s === "116") return "KHR";
  return null;
}

/**
 * Asks Bakong whether the dynamic KHQR with this md5 was paid (Open API v1.0.2,
 * POST /v1/check_transaction_by_md5). `data.hash` is the transaction hash, not our md5,
 * so a hit on the md5 lookup is the match; amount and currency are sanity checks.
 * `toAccountId` is not compared because ACLEDA sub-accounts settle via a bridge account.
 */
export async function verifyTxByMd5(
  md5: string,
  expected?: { amount: number; currency: Currency }
): Promise<{ paid: boolean; raw: unknown }> {
  try {
    const raw = (await getKhqr().api.check_transaction_by_md5(md5)) as unknown as Record<string, unknown>;
    if (process.env.NODE_ENV !== "production") console.log("[bakong] check_transaction_by_md5", md5, JSON.stringify(raw));
    if (raw.responseCode !== 0 || !raw.data || typeof raw.data !== "object") return { paid: false, raw };
    const tx = raw.data as Record<string, unknown>;
    if (expected) {
      const currency = txCurrency(tx.currency);
      if (currency && currency !== expected.currency) return { paid: false, raw };
      // The spec types amount as a string while its sample shows a number.
      if (tx.amount !== undefined && majorToMinor(Number(tx.amount), expected.currency) !== expected.amount)
        return { paid: false, raw };
    }
    return { paid: true, raw };
  } catch (e) {
    return { paid: false, raw: { error: String(e) } };
  }
}

export function liveVerificationEnabled(): boolean {
  return !!process.env.BAKONG_TOKEN;
}
