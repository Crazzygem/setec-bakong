// Minimal EMV QR (KHQR) tag editing, used to turn a bank-issued static QR into a
// per-bill dynamic one without touching the account tags the bank routes on.

import { createHash } from "node:crypto";
import { minorToMajor, type Currency } from "@/lib/money";

type Tlv = [tag: string, value: string];

export function parseTlv(s: string): Tlv[] {
  const out: Tlv[] = [];
  let i = 0;
  while (i < s.length) {
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(len) || i + 4 + len > s.length) throw new Error("Not a valid EMV QR string");
    out.push([tag, s.slice(i + 4, i + 4 + len)]);
    i += 4 + len;
  }
  return out;
}

function tlv(tag: string, value: string): string {
  if (value.length > 99) throw new Error(`Tag ${tag} is longer than 99 characters`);
  return tag + String(value.length).padStart(2, "0") + value;
}

const byTag = (a: Tlv, b: Tlv) => Number(a[0]) - Number(b[0]);

/** CRC-16/CCITT-FALSE over the payload including "6304", as EMV QR requires. */
export function crc16(s: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(s, "utf8")) {
    crc ^= byte << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function hasValidCrc(qr: string): boolean {
  return qr.length > 8 && qr.slice(-8, -4) === "6304" && crc16(qr.slice(0, -4)) === qr.slice(-4).toUpperCase();
}

/**
 * Rebuilds a static bank QR as a dynamic bill: PoIM 12, currency, amount, bill number
 * and the KHQR tag-99 timestamps in milliseconds. Every other tag is kept byte for byte.
 */
export function dynamicFromStatic(
  source: string,
  o: { currency: Currency; amount: number; billNumber: string; expiresAt: number }
): { qr: string; md5: string } {
  if (!hasValidCrc(source)) throw new Error("The source QR fails its checksum");
  const keep = parseTlv(source).filter(([t]) => !["01", "53", "54", "63", "99"].includes(t));

  const extra = keep.find(([t]) => t === "62");
  const sub = extra ? parseTlv(extra[1]).filter(([t]) => t !== "01") : [];
  const bill = o.billNumber.replace(/[^A-Za-z0-9]/g, "").slice(0, 25);
  const additional = [...sub, ["01", bill] as Tlv].sort(byTag);

  const major = minorToMajor(o.amount, o.currency);
  const tags: Tlv[] = [
    ...keep.filter(([t]) => t !== "62"),
    ["01", "12"],
    ["53", o.currency === "USD" ? "840" : "116"],
    ["54", o.currency === "USD" ? major.toFixed(2) : String(major)],
    ["62", additional.map(([t, v]) => tlv(t, v)).join("")],
    ["99", tlv("00", String(Date.now())) + tlv("01", String(o.expiresAt))],
  ];
  const body = tags.sort(byTag).map(([t, v]) => tlv(t, v)).join("") + "6304";
  const qr = body + crc16(body);
  return { qr, md5: createHash("md5").update(qr).digest("hex") };
}
