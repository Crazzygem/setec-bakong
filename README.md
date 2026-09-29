# Bakong Cinema Rooms

Private cinema rooms booked by the hour, with the tab paid by scanning a Bakong KHQR
code from any Cambodian banking app. Built as a SETEC e-commerce class project.

Five rooms (A1, A2, B1, B2, VIP) and a six-item snack menu are seeded on first run.
Prices, room codes and menu items are editable at runtime in Admin.

## How it works

A guest scans the QR code on their door, which opens `/t/A1`. From there they add time
to the booking, order snacks, and pay the running tab. Staff work from `/staff`: start a
booking, add tab items, and bill it. The bill produces a KHQR invoice, the guest scans it
in their banking app, and the invoice settles once the server confirms the transfer.

Money is stored as integers in the currency's minor unit (US cents, or whole riel), so no
float ever reaches a QR amount tag. Tab lines and invoices each carry their own currency,
which keeps past bills correct after the shop currency changes.

## Pages

| Route | What it does |
|---|---|
| `/` | Room code entry and a live grid of room status |
| `/t/[code]` | Guest view for one room: extend time, order from the menu, pay |
| `/staff` | Staff POS: open bookings, add tab items, raise invoices |
| `/admin` | Rooms, menu, and booking history |
| `/admin/rooms/[id]/print` | Printable door card with the room QR code |
| `/admin/khqr-test` | Generates KHQR variants and decodes a scanned code, for testing against your own bank app |
| `/pay/[invoiceId]` | Standalone payment page for one invoice |

## Running it

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. `.env.example` documents every variable.

With no `BAKONG_TOKEN` set, the app runs in demo mode and the payment screen offers a
Simulate button that marks an invoice paid without moving money. Setting a token turns
simulation off unless `SIMULATE_PAYMENTS=true` is set on purpose.

## KHQR generation

The QR for an invoice can be built two ways, and `MERCHANT_KHQR_SOURCE` decides which:

1. **Copy your bank's static QR.** Paste the receive-money QR string from ACLEDA mobile
   under My KHQR into `MERCHANT_KHQR_SOURCE`. `lib/emv.ts` rewrites only the amount
   (tag 54), bill number (tag 26), expiry and CRC tags, leaving every account tag the
   bank routes on byte for byte. This is the reliable path, because the bank already
   accepted that exact string.
2. **Build it from fields.** Without `MERCHANT_KHQR_SOURCE`, the merchant fields build the
   QR through NBC's official SDK. A bank app rejects this if the layout does not match how
   that bank registered the account, so use `/admin/khqr-test` to compare variants and
   find one your app opens.

Two details worth knowing before you debug a QR that will not scan:

- Tag 29 is an individual account, tag 30 is a merchant ID. A shared ID such as
  `khqr@aclb` may be registered either way, so `MERCHANT_KHQR_LAYOUT` matters.
- `SHOP_CURRENCY` must match what the receiving bank account accepts. A USD-only account
  rejects a KHR QR at account inquiry, which looks like a scan failure but is not.

Invoice QRs expire after five minutes. The browser polls `/check` every three seconds;
the server spaces real Bakong lookups at least 15 seconds apart per invoice, because
Bakong allows 100 md5 checks per token per day. Hitting that quota returns error code 17,
and the app stops checking until midnight in Phnom Penh.

## Deployment

`Dockerfile` and `railway.toml` are set up for Railway. The container keeps its SQLite
file on a `/data` volume and runs `npm start`; set `DATABASE_PATH` to a path inside that
volume. `APP_URL` pins printed door QR codes to one domain, otherwise the print page
uses whatever address you loaded it from.

There is no authentication. `/admin` and `/staff` are open to anyone who can reach the
server, so keep this behind a private network or an access proxy.

## Stack

Next.js 15 App Router, React 19, TypeScript, Tailwind v4, better-sqlite3, and
`@manethpak/khqr-sdk` plus `bakong-khqr`. QR generation uses NBC's SDK because the
community package writes tag-99 timestamps in seconds, which strict bank apps reject.
