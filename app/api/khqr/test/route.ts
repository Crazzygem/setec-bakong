import { NextResponse } from "next/server";
import { BakongKHQR } from "bakong-khqr";
import { buildKhqr, decodeKhqr, khqrFromSource, merchantKhqrDefaults, type KhqrOptions, type QRGenResult } from "@/lib/bakong";
import { parseTlv } from "@/lib/emv";
import { isCurrency, type Currency } from "@/lib/money";

export const dynamic = "force-dynamic";

// Each variant changes one thing, so a single scan shows which part a bank app rejects.
type Variant = "pos" | "static" | "no-bank" | "merchant" | "custom" | "mirror";

/**
 * ACLEDA marks accounts with both a KHR and a USD default account with tag 39 "2CCY";
 * those take either currency. Any other bank QR is kept in the currency it names.
 */
function currencyForSource(source: string, requested: Currency): Currency {
  const tags = parseTlv(source);
  if (tags.some(([t, v]) => t === "39" && v.includes("2CCY"))) return requested;
  const code = tags.find(([t]) => t === "53")?.[1];
  return code === "840" ? "USD" : code === "116" ? "KHR" : requested;
}

function envLines(o: KhqrOptions): string[] {
  return [
    `MERCHANT_KHQR_LAYOUT=${o.layout ?? "individual"}`,
    `MERCHANT_BAKONG_ID=${o.bakongId}`,
    `MERCHANT_ACCOUNT_INFO=${o.accountInformation ?? ""}`,
    `MERCHANT_ACQUIRING_BANK=${o.acquiringBank ?? ""}`,
    `SHOP_CURRENCY=${o.currency}`,
  ];
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    variant?: Variant;
    bakongId?: string;
    amount?: number;
    currency?: string;
    source?: string;
  };
  if (!isCurrency(body.currency)) return NextResponse.json({ error: "currency must be USD or KHR" }, { status: 400 });
  let currency: Currency = body.currency;
  const merchant = merchantKhqrDefaults();
  const billNumber = "test" + Date.now().toString(36);

  // A bank-issued QR (pasted, or MERCHANT_KHQR_SOURCE for the POS variant) is copied exactly.
  const envSource = process.env.MERCHANT_KHQR_SOURCE?.trim();
  const source = body.variant === "mirror" ? String(body.source ?? "").trim() : body.variant === "pos" ? envSource : undefined;
  if (body.variant === "mirror" && !source) return NextResponse.json({ error: "Upload a bank QR first." }, { status: 400 });

  let opts: KhqrOptions | null = null;
  if (source) {
    try {
      currency = currencyForSource(source, currency);
    } catch {
      return NextResponse.json({ error: "That is not a valid KHQR string." }, { status: 422 });
    }
  } else {
    switch (body.variant) {
      case "pos":
      case "static":
        opts = { ...merchant, currency };
        break;
      case "no-bank":
        opts = { ...merchant, layout: "individual", acquiringBank: undefined, currency };
        break;
      case "merchant":
        opts = { ...merchant, layout: "merchant", currency };
        break;
      case "custom": {
        const bakongId = String(body.bakongId ?? "").trim();
        if (!/^[^@\s]+@[a-z0-9]+$/i.test(bakongId))
          return NextResponse.json({ error: "Enter a Bakong ID like name@aclb." }, { status: 400 });
        const base = process.env.BAKONG_BASE_URL ?? "https://api-bakong.nbc.gov.kh";
        const exists = await BakongKHQR.checkBakongAccount(`${base}/v1/check_bakong_account`, bakongId).catch(() => null);
        if (exists?.data && !exists.data.bakongAccountExisted)
          return NextResponse.json({ error: `Bakong has no account called ${bakongId}.` }, { status: 404 });
        opts = { layout: "individual", bakongId, currency };
        break;
      }
      default:
        return NextResponse.json({ error: "unknown variant" }, { status: 400 });
    }
  }

  const minimum = currency === "USD" ? 1 : 100;
  // The requested amount is in the requested currency; if the source QR switched it, use the minimum.
  const requested = currency === body.currency ? Number(body.amount) : NaN;
  const amount = Math.max(minimum, Math.round(requested || minimum));

  let res: QRGenResult;
  let env: string[];
  if (source) {
    res = khqrFromSource(source, { currency, amount, billNumber });
    env = [`MERCHANT_KHQR_SOURCE=${source}`, `SHOP_CURRENCY=${currency}`];
  } else {
    if (body.variant !== "static") opts = { ...opts!, amount, billNumber };
    res = buildKhqr(opts!);
    env = envLines(opts!);
  }
  if (!res.result) return NextResponse.json({ error: res.error?.message ?? "QR generation failed" }, { status: 422 });
  return NextResponse.json({
    ...res.result,
    amount: body.variant === "static" ? null : amount,
    currency,
    env,
    ...decodeKhqr(res.result.qr),
  });
}
