"use client";

import Link from "next/link";
import { useState } from "react";
import jsQR from "jsqr";
import { generateKHQRSVG, svgToDataURI } from "@manethpak/khqr-sdk/svg";
import { useShopCurrency } from "@/components/currency";
import { Button, Field, Notice } from "@/components/ui";
import { formatMoney, type Currency } from "@/lib/money";

type Variant = "pos" | "static" | "no-bank" | "merchant" | "custom" | "mirror";

interface Generated {
  qr: string;
  md5: string;
  amount: number | null;
  currency: Currency;
  valid: boolean;
  env: string[];
  fields: Record<string, unknown>;
}

const VARIANTS: { id: Exclude<Variant, "mirror">; title: string; tests: string }[] = [
  {
    id: "pos",
    title: "A. Same as the POS",
    tests: "Exactly what the POS makes now: a copy of MERCHANT_KHQR_SOURCE if set, otherwise the separate MERCHANT_ fields.",
  },
  {
    id: "merchant",
    title: "E. Same fields, merchant layout",
    tests: "The same Bakong ID, account and bank under tag 30. Shared IDs like khqr@aclb may be registered this way.",
  },
  {
    id: "static",
    title: "B. No amount, no expiry",
    tests: "If B opens but A does not, the bank app is rejecting the amount or expiry fields.",
  },
  {
    id: "no-bank",
    title: "C. Without the bank name",
    tests: "Drops the acquiring-bank field. If C opens but A does not, that field is the problem.",
  },
  {
    id: "custom",
    title: "D. Your personal Bakong ID",
    tests: "An ID like name@aclb with no account number. Bakong confirms the ID exists first.",
  },
];

const CURRENCY_CODES: Record<string, string> = { "840": "USD", "116": "KHR" };
const LAYOUTS: Record<string, string> = { "29": "personal (tag 29)", "30": "merchant (tag 30)" };

function topLevelTags(s: string): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i + 4 <= s.length; ) {
    const len = Number(s.slice(i + 2, i + 4));
    if (!Number.isInteger(len)) break;
    out.push([s.slice(i, i + 2), s.slice(i + 4, i + 4 + len)]);
    i += 4 + len;
  }
  return out;
}

async function requestQr(body: object): Promise<{ data?: Generated; error?: string }> {
  try {
    const res = await fetch("/api/khqr/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return res.ok ? { data } : { error: data.error ?? "The QR could not be made." };
  } catch {
    return { error: "No connection to the server. Try again." };
  }
}

function Fields({ fields }: { fields: Record<string, unknown> }) {
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {Object.entries(fields).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="break-all">
            {String(v)}
            {k === "transactionCurrency" && CURRENCY_CODES[String(v)] ? ` (${CURRENCY_CODES[String(v)]})` : ""}
            {k === "merchantType" && LAYOUTS[String(v)] ? ` (${LAYOUTS[String(v)]})` : ""}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function GeneratedQr({ gen, label }: { gen: Generated; label: string }) {
  const [check, setCheck] = useState<string | null>(null);
  let img: string | null = null;
  try {
    const r = generateKHQRSVG(gen.qr);
    img = r.result ? svgToDataURI(r.result) : null;
  } catch {
    img = null;
  }

  async function checkPaid() {
    setCheck("Asking Bakong…");
    const res = await fetch("/api/khqr/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ md5: gen.md5, amount: gen.amount, currency: gen.currency }),
    }).catch(() => null);
    if (!res) return setCheck("No connection to the server.");
    const data = await res.json();
    setCheck(res.ok ? `${data.paid ? "Paid." : "Not found yet."} Bakong replied: ${JSON.stringify(data.raw)}` : data.error);
  }

  return (
    <div className="mt-4">
      <p className="text-center text-lg font-semibold tabular-nums">
        {gen.amount === null ? `Any amount in ${gen.currency}` : formatMoney(gen.amount, gen.currency)}
      </p>
      {img && <img src={img} alt={`Test KHQR, ${label}`} className="mx-auto mt-2 w-full max-w-[240px]" />}
      <p className="mt-2 text-center text-sm text-muted">NBC SDK check: {gen.valid ? "valid" : "invalid"}</p>
      <Button className="mt-3 w-full" variant="secondary" size="sm" onClick={checkPaid}>
        Ask Bakong if this was paid
      </Button>
      {check && <p className="mt-2 text-xs break-all text-body">{check}</p>}
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm text-body">If this one works: settings for .env.local</summary>
        <pre className="overflow-x-auto rounded-sm bg-surface-soft p-3 text-xs">{gen.env.join("\n")}</pre>
      </details>
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm text-body">Decoded fields</summary>
        <Fields fields={gen.fields} />
      </details>
    </div>
  );
}

function VariantCard({ v, currency, amount }: { v: (typeof VARIANTS)[number]; currency: Currency; amount: number }) {
  const [bakongId, setBakongId] = useState("");
  const [gen, setGen] = useState<Generated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    const r = await requestQr({ variant: v.id, bakongId, amount, currency });
    setBusy(false);
    setGen(r.data ?? null);
    setError(r.error ?? null);
  }

  return (
    <div className="rounded-md border border-hairline p-6">
      <h2 className="text-base font-semibold">{v.title}</h2>
      <p className="mt-1 text-sm text-body">{v.tests}</p>
      {v.id === "custom" && (
        <Field
          id="custom-id"
          className="mt-4"
          label="Bakong ID"
          placeholder="yourname@aclb"
          value={bakongId}
          onChange={(e) => setBakongId(e.target.value.trim())}
          autoCapitalize="none"
          autoComplete="off"
        />
      )}
      <Button
        className="mt-4"
        variant="secondary"
        size="sm"
        onClick={generate}
        disabled={busy || (v.id === "custom" && !bakongId)}
      >
        {gen ? `Make a new ${currency} QR` : `Make ${currency} QR`}
      </Button>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {gen && gen.currency !== currency && (
        <p className="mt-3 text-sm text-error">This QR is in {gen.currency}. Make a new one for {currency}.</p>
      )}
      {gen && <GeneratedQr key={gen.md5} gen={gen} label={v.title} />}
    </div>
  );
}

function DecodeBankQr({ currency, amount }: { currency: Currency; amount: number }) {
  const [source, setSource] = useState<string | null>(null);
  const [result, setResult] = useState<{ valid: boolean; fields: Record<string, unknown> } | null>(null);
  const [copy, setCopy] = useState<Generated | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    setCopy(null);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return setError("This browser cannot read images.");
      ctx.drawImage(bitmap, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height);
      if (!code) return setError("No QR code found. Crop the screenshot closer to the QR and try again.");
      const res = await fetch("/api/khqr/decode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ qr: code.data }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? "That QR could not be decoded.");
      setSource(code.data);
      setResult(data);
    } catch {
      setError("That file could not be read as an image.");
    }
  }

  async function makeCopy() {
    if (!source) return;
    const r = await requestQr({ variant: "mirror", source, amount, currency });
    setCopy(r.data ?? null);
    setError(r.error ?? null);
  }

  const f = result?.fields ?? {};
  // NBC's decoder drops tag 39, where ACLEDA flags "2CCY": a KHR and a USD default account.
  const dual = source ? topLevelTags(source).some(([t, v]) => t === "39" && v.includes("2CCY")) : false;
  const currencyName = dual ? "both KHR and USD" : CURRENCY_CODES[String(f.transactionCurrency ?? "")];
  const layoutName = LAYOUTS[String(f.merchantType ?? "")];

  return (
    <section className="mt-12 rounded-md bg-surface-soft p-6">
      <h2 className="text-xl font-semibold">Copy your bank&apos;s own QR (most reliable)</h2>
      <p className="mt-2 max-w-2xl text-body">
        Your bank&apos;s receive-money QR is the one layout the bank is sure to accept. In ACLEDA mobile, open your
        receive-money KHQR, take a screenshot and upload it. Then make a payable copy: the same account fields, plus an
        amount and a 5-minute expiry. If ABA opens the copy, use the settings shown under it. The image stays in this
        browser; only the decoded text reaches the server.
      </p>
      <label htmlFor="bank-qr" className="mt-4 block text-sm font-medium text-muted">
        Screenshot of the QR
      </label>
      <input
        id="bank-qr"
        type="file"
        accept="image/*"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        className="mt-1 block min-h-11 text-sm file:mr-4 file:min-h-11 file:rounded-sm file:border file:border-ink file:bg-canvas file:px-4 file:font-medium file:text-ink"
      />
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {result && (
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div className="rounded-md bg-canvas p-4">
            <p className="font-semibold">
              {layoutName ? `Layout: ${layoutName}. ` : ""}
              {currencyName ? `Receives ${currencyName}.` : "No currency in this QR."}
            </p>
            <p className="text-sm text-muted">NBC SDK check: {result.valid ? "valid" : "invalid"}</p>
            <Fields fields={result.fields} />
            <Button className="mt-4 w-full" onClick={makeCopy}>
              Make a payable copy
            </Button>
          </div>
          {copy && (
            <div className="rounded-md bg-canvas p-4">
              <p className="font-semibold">Payable copy</p>
              <GeneratedQr key={copy.md5} gen={copy} label="payable copy" />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function KhqrTestPage() {
  const shop = useShopCurrency();
  const [currency, setCurrency] = useState<Currency>(shop);
  const [amountInput, setAmountInput] = useState(shop === "USD" ? "0.05" : "100");
  const amount = Math.round(Number(amountInput) * (currency === "USD" ? 100 : 1)) || (currency === "USD" ? 1 : 100);

  function switchCurrency(c: Currency) {
    setCurrency(c);
    setAmountInput(c === "USD" ? "0.05" : "100");
  }

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 md:py-12 lg:px-10">
      <Link href="/admin" className="flex min-h-11 items-center text-sm font-medium underline">
        Back to Admin
      </Link>
      <h1 className="mt-2 text-[28px] font-bold">Test KHQR with a bank app</h1>
      <p className="mt-2 max-w-2xl text-body">
        Scan each QR and note which ones open the payment screen. Use a different account from the one receiving the
        money: paying yourself can be refused too. Start with the copy of your bank&apos;s own QR just below.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-6">
        <div>
          <p className="text-sm font-medium text-muted" id="cur-label">
            Currency
          </p>
          <div role="group" aria-labelledby="cur-label" className="mt-1 inline-flex rounded-sm border border-field p-1">
            {(["USD", "KHR"] as Currency[]).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={currency === c}
                onClick={() => switchCurrency(c)}
                className={`min-h-11 min-w-20 rounded-xs px-4 text-sm font-semibold ${
                  currency === c ? "bg-ink text-white" : "text-ink hover:bg-surface-soft"
                }`}
              >
                {c}
                {c === shop ? " (shop)" : ""}
              </button>
            ))}
          </div>
        </div>
        <Field
          id="test-amount"
          className="w-40"
          label={`Test amount (${currency})`}
          type="number"
          inputMode="decimal"
          min={currency === "USD" ? 0.01 : 100}
          step={currency === "USD" ? 0.01 : 100}
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
        />
      </div>

      <DecodeBankQr currency={currency} amount={amount} />

      <h2 className="mt-12 text-xl font-semibold">Variations on your current settings</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {VARIANTS.map((v) => (
          <VariantCard key={v.id} v={v} currency={currency} amount={amount} />
        ))}
      </div>
    </div>
  );
}
