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

Payments are confirmed by staff, and the app never asks Bakong on its own. The staff
screen has two buttons under the QR:

- **Check payment with Bakong** makes one Bakong lookup per click, like the test page,
  and marks the bill paid if Bakong has the transfer. It needs `BAKONG_TOKEN`.
- **Confirm payment received** marks it paid without a lookup, after you saw the money in
  the Bakong app. It works with no token, and when the daily limit is used up.

The guest's screen flips to paid once staff confirm.

## Charging in riel or dollars

Prices are set in the shop currency, `SHOP_CURRENCY`. At the till, staff can charge a bill
in either currency: the POS has a `៛ Riel` / `$ US Dollar` toggle next to the charge
button, and the guest's own pay button uses the shop currency. The tab total is converted
once at 4,000 riel to the dollar, and the invoice records the currency it was charged in.

The price is always rounded up, and a riel price is always a whole 100, so ៛3,300 bills as
$0.83 and $0.83 bills as ៛3,400. Rounding up means the shop is never short.

This only works if the settlement account takes both currencies. A Bakong wallet holds both
KHR and USD, and each bill's tag `53` picks which one is credited. The wallet's QR names
only KHR, so list the currencies in `MERCHANT_KHQR_CURRENCIES=KHR,USD`. (A bank QR that
marks its own dual-currency account, such as ACLEDA's tag `39` `2CCY`, needs no setting.)
The app logs the account's capability at boot, and refuses a bill in a currency the
account cannot take rather than producing a QR that will not scan.

## KHQR generation

The QR for an invoice can be built two ways, and `MERCHANT_KHQR_SOURCE` decides which:

1. **Copy a Bakong wallet's static QR.** Paste the receive-money QR string of your Bakong
   account (Bakong app, or a bank app's Bakong QR whose ID looks like `name@bkrt`) into
   `MERCHANT_KHQR_SOURCE`. `lib/emv.ts` rewrites only the amount, currency, bill number,
   expiry and CRC tags, leaving every account tag byte for byte. Money is credited to that
   Bakong wallet, and every bank app can pay it. The bare Bakong ID is the only account
   form that ABA, Wing and ACLEDA all opened in testing.

   A bank's own QR (ACLEDA's `khqr@aclb` plus an account number and bank name) opens in
   that bank's app and was rejected as an invalid QR by ABA. It routes inside the issuing
   bank, so use it only if guests all use that bank.
2. **Build it from fields.** Without `MERCHANT_KHQR_SOURCE`, the merchant fields build the
   QR through NBC's official SDK. A bank app rejects this if the layout does not match how
   that bank registered the account, so use `/admin/khqr-test` to compare variants and
   find one your app opens.

Two details worth knowing before you debug a QR that will not scan:

- Tag 29 is an individual account, tag 30 is a merchant ID. A shared ID such as
  `khqr@aclb` may be registered either way, so `MERCHANT_KHQR_LAYOUT` matters (field
  path only).
- `SHOP_CURRENCY` must match what the receiving bank account accepts. A USD-only account
  rejects a KHR QR at account inquiry, which looks like a scan failure but is not.

Invoice QRs expire after five minutes, so confirm within that window. The browser polls
`/check` every three seconds, but that reads only the local database. It never calls
Bakong. An earlier version checked Bakong automatically, and its 100-checks-per-token-per-day
limit ran out without confirming a single payment. Now only the Check button spends one.

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
