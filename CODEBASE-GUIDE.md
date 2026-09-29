# Bakong KHQR Rooms: codebase guide

A study guide for explaining the whole system in class. Read it in order the
first time. Before the presentation, re-read sections 1, 4, 6 and 12.

---

## 1. The 60-second version

Memorise this. It answers "explain your project" on its own.

> Bakong Cinema Rooms is a Next.js web app for a private cinema in Cambodia.
> Staff open a booking on a room, the guest's running tab collects room hours
> and snacks, and the guest pays the tab by scanning a Bakong KHQR code from
> any banking app. The system builds a per-bill KHQR code from the merchant's
> own bank QR, then confirms the payment through Bakong's Open API and settles
> the invoice.
>
> The project has six library files in `lib/`. The one that matters is
> `lib/emv.ts`, which rewrites five EMV tags inside the bank's static QR to turn
> it into a dynamic bill, so every account tag the bank routes on is preserved.
> `lib/payments.ts` throttles Bakong's md5 checks, because the API allows only
> 100 per token per day. `lib/money.ts` stores every amount as an integer in
> minor units, so no float ever reaches a QR amount field.
>
> The app has four roles in one codebase: the guest at `/t/A1`, staff at
> `/staff`, admin at `/admin`, and a KHQR test bench at `/admin/khqr-test`
> that generates QR variants and decodes scanned ones. It runs on SQLite in a
> single file, deploys to Railway from a Dockerfile, and has no automated tests.

---

## 2. How Next.js works (the part you need)

Every page and every data change follows the same path. If you understand this,
you can explain any feature.

```
Browser  ──request──▶  page.tsx  ──▶  fetch("/api/...")  ──▶  route.ts  ──▶  lib/
                                          ▲                          │
Browser  ◀─────HTML + JSON───────────────┴──────────────────────────┘
```

1. **Page** (`app/(site)/staff/page.tsx`): a React component that renders HTML.
   Ours are mostly `"use client"`, because they fetch and poll.
2. **`fetch("/api/bookings/…/invoices")`**: the page calls a URL. The browser
   asks our own server.
3. **Route handler** (`app/api/bookings/[id]/invoices/route.ts`): ordinary
   TypeScript with `export async function POST(req)`. It validates input, calls
   into `lib/`, and returns JSON.
4. **`lib/`**: plain TypeScript with no Next.js in it. `lib/db.ts` holds the
   SQL, `lib/bakong.ts` builds the QR, `lib/emv.ts` does the tag surgery.
5. The route returns JSON; the page's `setState` re-renders.

Next.js words you will use:

- **Route group** `(site)`: a folder in parentheses that does not change the URL.
  `app/(site)/staff/page.tsx` is served at `/staff`. We use it to put the header
  and footer on every page while `app/api/` and `app/staff/` sit outside it.
- **Server component vs client component**: default is server (runs only on the
  server). `"use client"` at the top opts into running in the browser, which is
  needed for `useState`, `useEffect` and `fetch` polling.
- **`force-dynamic`**: `export const dynamic = "force-dynamic"` stops Next.js
  caching the route. Every API route here has it, because room status and
  invoices must never be served stale.
- **`[id]`**: a dynamic segment, read as `ctx.params`, awaited (`const { id } =
  await ctx.params`) because Next.js 15 made params a promise.

Next.js calls its version of this **MVT**: Model, View, Template. Here the
"model" is `lib/db.ts`, the "view" is the route handler, the "template" is the
page component.

---

## 3. Folder map

```
Bakong_payment/
├── .env.example                 Every variable, documented, no secrets
├── Dockerfile                   3-stage build for Railway
├── railway.toml                 Tells Railway to use the Dockerfile
├── next.config.ts               distDir, and better-sqlite3 as an external package
├── app/
│   ├── layout.tsx               Root HTML, Inter font, CurrencyProvider
│   ├── globals.css              Tailwind v4 theme tokens (colours, radius, shadow)
│   ├── not-found.tsx            "We could not find that" for a bad room code
│   ├── (site)/                  Route group: gets the header and footer
│   │   ├── layout.tsx           SiteHeader + SiteFooter
│   │   ├── page.tsx             Home: room code search, live room grid
│   │   ├── staff/page.tsx       The POS: check in, add to tab, bill, check out
│   │   ├── admin/
│   │   │   ├── page.tsx         Rooms, menu, booking history (tabbed)
│   │   │   ├── khqr-test/       QR variant generator + scanner decoder
│   │   │   └── rooms/[id]/print Door card with the room QR, print styles
│   │   ├── t/[code]/            Guest view for one room (/t/A1)
│   │   │   ├── page.tsx         Server component: looks the room up
│   │   │   └── room-client.tsx  The interactive part: menu, tab, pay
│   │   └── pay/[invoiceId]/     Standalone payment page
│   ├── staff/page.tsx           /staff alias outside the group
│   └── api/                     18 route handlers
│       ├── rooms/                list, create, by-code, patch, mark ready
│       ├── menu/                 list, create, patch
│       ├── bookings/             create, read, items, invoices, close, cancel
│       ├── invoices/             list, read, check, cancel, simulate
│       └── khqr/                 test, decode, check
├── components/
│   ├── ui.tsx                   Button, Field, Notice, Wordmark, status label
│   ├── currency.tsx             Context carrying SHOP_CURRENCY to the client
│   ├── khqr-payment.tsx         The QR, the countdown, the polling
│   └── site-header.tsx          Header and footer
└── lib/
    ├── emv.ts                   TLV parse, CRC-16, static → dynamic rewrite
    ├── bakong.ts                QR generation, decoding, md5 verification
    ├── payments.ts              Throttle, quota backoff, settle
    ├── db.ts                    Schema, seed, migration, all SQL (571 lines)
    ├── money.ts                 Minor units, parsing, formatting
    ├── shop.ts                  Reads SHOP_CURRENCY
    └── bakong-khqr.d.ts         Types for the community SDK
```

Rule of thumb: **`emv.ts` → `bakong.ts` → `payments.ts` → `db.ts` → route
handler → page.** The tag surgery is used by the QR builder, the QR builder by
the payment layer, the payment layer by the invoice route, and the page polls
the route.

---

## 4. The data model

Five tables. Draw this on the board if asked.

```
Room ─┐
      ├─< Booking ─┬─< TabItem
      │             │
      │             └─< Invoice
      │
MenuItem ────────< TabItem
```

`─<` means "one to many". One room has many bookings over time. One booking has
many tab lines. One booking has many invoices. One menu item can appear on many
tab lines.

| Table | Important fields | Notes |
|---|---|---|
| `rooms` | `code` (unique), `name`, `hourly_rate`, `capacity`, `status` | `code` is on the printed QR, so it can never be edited after creation |
| `menu_items` | `name`, `price`, `available` | `available` hides an item without deleting its history |
| `bookings` | `room_id`, `customer_name`, `ends_at`, `status` | `ends_at` is pushed forward when an invoice settles |
| `tab_items` | `kind` (`ROOM_HOURS` / `SNACK`), `label`, `qty`, `unit_price`, `currency`, `state` | `label` is copied at insert, so renaming a menu item never rewrites history |
| `invoices` | `total`, `currency`, `qr`, `md5` (unique), `status`, `lines_json`, `expires_at` | `lines_json` is the snapshot, see section 7 |

Three status columns carry the whole workflow:

- **Room**: `AVAILABLE` → `OCCUPIED` → `CLEANING` → `AVAILABLE`. The room only
  goes back to `AVAILABLE` when staff press "mark ready", so a guest cannot
  book a room that has not been cleaned.
- **Booking**: `ACTIVE` → `CLOSED` (paid, guest leaves) or `CANCELLED` (voided).
- **Invoice**: `PENDING` → `PAID` or `EXPIRED`. `EXPIRED` also means "cancelled
  by staff", the two are the same row state.

### The three database guarantees

- **`UNIQUE` on `rooms.code`**: two rooms cannot share a code, so a printed QR
  can never point at two rooms. The create route catches the error and says
  "Room A1 already exists."
- **`UNIQUE` on `invoices.md5`**: one QR hash is one invoice. The invoice route
  carries a retry loop so a (practically impossible) hash collision retries once
  with a new id instead of crashing.
- **`FOREIGN KEYS ON`** plus `REFERENCES rooms(id)`: a tab line cannot exist
  without its booking. better-sqlite3 has this off by default, so
  `lib/db.ts` turns it on with `db.pragma("foreign_keys = "ON")`.

### `closeBooking` refuses three things (slide: staff workflow)

`lib/db.ts` will not close a booking if:

1. the booking is not `ACTIVE` (already closed)
2. a `PENDING` invoice has not expired yet, so staff are told "A payment QR is
   still waiting. Cancel it or wait for payment."
3. `unbilledTotal > 0`, so staff are told "Collect payment for the bill first."

The guest is never walked out on an unpaid tab by accident.

### `cancelBooking` is the opposite

It voids every `UNBILLED` line, expires any open QR, sets the booking to
`CANCELLED` and frees the room in one transaction, then returns whatever was
already `PAID` so the UI can still show it. The caller (the cancel route) must
first rule out a QR that was paid but not yet settled.

---

## 5. Money handling

File: `lib/money.ts`. Small, and the whole payment layer depends on it.

Amounts are **integers in the currency's minor unit**. US cents are two digits,
riel is zero:

```ts
const DIGITS: Record<Currency, number> = { USD: 2, KHR: 0 };
```

So $10.00 is `1000` in the database, and 300 riel is `300`. Nothing is a float.

### Why this matters more than tidiness

`minorToMajor` runs its result through `toFixed`:

```ts
return Number((minor / 10 ** d).toFixed(d));
```

That kills float noise like `0.30000000000000004`. A bank app compares the
amount field in the QR as a **string**, so a stray float digit is a rejected
payment, not a rounding difference. This one function is the reason a KHQR
built from our database scans at all.

`parseMoneyInput` is the reverse, for what a person typed: it strips `,`, `$`
and `៛`, then refuses anything that is not a positive amount. `null` means
invalid, and the form shows the error.

`KHR_PER_USD = 4000` is used by `convertMinor`, but only when `SHOP_CURRENCY`
changes. It is never used for a live payment. Say that if anyone asks whether
we do currency conversion at checkout. We do not.

### Per-line currency

Every `tab_items` row and every `invoices` row carries its own `currency`,
alongside the shop-wide `SHOP_CURRENCY`.

Why: switch the shop to USD and already-closed bills must still show the riel
they were charged in. `syncPriceCurrency` re-prices rooms, menu, and only
`UNBILLED` lines. Billed history is untouched. The invoice route still refuses a
booking whose unbilled lines are in mixed currencies, but that can now only
happen on a booking left over from a currency change.

### Staff choose the currency to charge (slide: the POS)

A guest who asks to pay in dollars is not turned away. On the POS, next to
"Charge with KHQR", there is a two-button toggle, `៛ Riel` and `$ US Dollar`,
with `aria-pressed` on the active one. Staff pick, not the guest: the guest's own
pay button sends no currency and the server falls back to `SHOP_CURRENCY`.

The tab is priced in the shop currency, so the other option converts it. Three
parts do that:

1. `app/staff/page.tsx` `BillPanel` calls `toBillAmount` on every render, so the
   total and the button label update as staff toggle. It shows the riel original
   under the figure when the two differ.
2. `app/api/bookings/[id]/invoices/route.ts` reads `currency` from the body and
   converts again, server-side. The client figure is a preview; the invoice total
   is whatever the server computed.
3. `lib/bakong.ts` `generateInvoiceQR` takes the currency, so tag `53` in the QR
   is `840` for a dollar bill and `116` for a riel bill.

`sourceAcceptsCurrency` guards the last step. A single-currency account fails
the other currency at the bank's account inquiry, which looks like a QR that will
not scan, so the route returns a clear 422 instead. A Bakong wallet holds both
KHR and USD and tag `53` picks the one credited, but its QR names only KHR, so
`MERCHANT_KHQR_CURRENCIES=KHR,USD` (read by `declaredCurrencies` in
`lib/shop.ts`) declares both. A bank QR that marks its own dual-currency account,
like ACLEDA's tag `39` `2CCY`, needs no setting.

### Rounding is always up (slide: money)

`toBillAmount` in `lib/money.ts` rounds the price up, and a riel price is always
a whole 100:

| Tab | Charged | Extra |
|---|---|---|
| ៛3,300 | $0.83 | 20 riel |
| $0.83 | ៛3,400 | 80 riel |
| ៛4,000 | $1.00 | none |
| $8.25 | ៛33,000 | none |

Rounding up means the shop is never short. Worst case is 20 riel going one way
and 99 the other, both under half a cent.

Two details to know if asked:

- **`toBillAmount` is not `convertMinor`.** `convertMinor` re-prices the menu and
  has a $1.00 floor, which would turn a $0.75 tab into a $1.00 charge. A billing
  function must never inflate a small bill, so it has no floor.
- **The `1e-9` in the `Math.ceil` calls.** `83 * 40` lands at `3300.0000000000005`,
  which without the epsilon would round up a whole extra step and charge ៛3,400
  for an exact ៛3,300. This is float noise in the same family as the `toFixed` in
  `minorToMajor`.

---

## 6. KHQR generation (the core of the project)

This is the section to spend your time on. A KHQR code is an EMV TLV string: a
two-digit tag, a two-digit length, then that many characters.

```
000201  01 12            ← PoIM: 12 = dynamic (has an amount)
        29 14  85010012…  ← individual account (the bits the bank routes on)
        53 03  116         ← currency: 116 = KHR, 840 = USD
        54 05  12345       ← amount
        62 09  0105 INV1234 ← bill number
        99 16  000814…     ← initiated + expiry, in MILLISECONDS
        6304 1A2B          ← CRC-16
```

### Two ways to build a bill

**Path 1, copy a static QR (the reliable one).** Paste the receive-money QR
string of a Bakong wallet into `MERCHANT_KHQR_SOURCE`. `dynamicFromStatic`
rewrites only five tags and keeps every other byte:

| Tag | Becomes |
|---|---|
| `01` | `11` (static) → `12` (dynamic), so the app uses the amount |
| `53` | currency, `840` USD or `116` KHR |
| `54` | the amount |
| `62` | sub-tag `01`, the bill number |
| `99` | sub-tags `00` and `01`, initiated and expiry, in ms |

Then it recomputes the CRC. Every account tag is kept exactly as issued.

**Which static QR you copy decides who can pay.** Decoding QRs from ACLEDA, ABA
and Wing showed the same shape: tag `29` with the bank's shared ID, an account
and the bank name, plus a private tag (ACLEDA `39` `2CCY`, ABA `40`, Wing `42`).
That shape routes inside the issuing bank. A bill copied from ACLEDA's QR opened
in ACLEDA but ABA said invalid QR, and stripping tag `39` changed nothing. A bare
Bakong wallet ID (`name@bkrt`, tag `29` with sub-tag `00` only) opened in both,
and the money is credited straight to the Bakong wallet. So use the wallet QR.

**Path 2, build from merchant fields (the fragile one).** Without
`MERCHANT_KHQR_SOURCE`, NBC's official SDK builds the QR from the Bakong ID,
account and acquiring bank. A bank app rejects this when the layout does not
match how that bank registered the account. There is no documentation that
tells you which layout yours is.

### `/admin/khqr-test` exists because of Path 2

It generates five variants that each change exactly one thing, so a single scan
tells you which part the app rejected:

| Variant | What it changes | What it tells you |
|---|---|---|
| A. Same as the POS | nothing, this is the live config | the baseline |
| B. No amount, no expiry | drops `54` and `99` | if B opens and A does not, the amount or expiry is the problem |
| C. Without the bank name | drops the acquiring bank | if C opens and A does not, that field is |
| D. Your personal Bakong ID | uses an ID you type, checked against Bakong | tests whether the shared ID is the issue |
| E. Merchant layout | same fields, tag `30` instead of `29` | tests individual vs merchant registration |

It also has a **mirror** mode: scan any QR with the phone camera (jsQR), and the
page decodes it and shows every field. That tells you what the app actually
read, which is the only way to settle a layout question.

This is the most defensible part of the project, because it is empirical rather
than theoretical.

### Two things that look arbitrary until they bite

**Tag 29 vs tag 30.** `29` is an individual account, `30` is a merchant ID. A
shared ID like `khqr@aclb` may be registered either way. `MERCHANT_KHQR_LAYOUT`
chooses, and the only way to know which is right is variant E.

**Currency mismatch looks like a broken QR.** `SHOP_CURRENCY` must match what
the receiving account accepts. A USD-only account rejects a KHR QR at account
inquiry. The symptom is "the QR will not scan", but the cause is the currency.

### Why the official SDK and not the community one

`@manethpak/khqr-sdk` writes tag-99 timestamps in **seconds**. Strict bank apps
reject that. So generation uses NBC's `bakong-khqr` package, and the community
client is kept only for Open API calls. The two libraries are used together for
different jobs, which is a real engineering decision rather than a preference.

For Path 1 the `md5` is computed locally as an MD5 of the QR string
(`createHash("md5").update(qr)`), because that is the identifier Bakong indexes.
For Path 2 the SDK returns it.

Before returning, Path 1 verifies the rebuilt string with `BakongKHQR.verify()`.
So we build with our own EMV code and validate with the official library.

---

## 7. Follow one click through the code

The best way to show you understand a codebase is to trace one action. Learn
this one: **staff click "Charge ៛X with KHQR".**

1. **Page** `app/staff/page.tsx`, `onCharge`: sets `checkout` to
   `{ kind: "qr", invoiceId }` after `POST /api/bookings/{id}/invoices`, and
   renders `<KhqrPayment key={invoiceId} …>`. The `key` matters: it remounts the
   component so its timers reset for the new invoice.
2. **Route** `app/api/bookings/[id]/invoices/route.ts`, `POST`:
   - rejects a non-`ACTIVE` booking (409)
   - **returns the still-open QR** if one exists, instead of minting a second
     bill. If it has expired it force-checks Bakong first, so a late payment is
     settled rather than double-billed.
   - reads `unbilledLines`, sums `qty * unit_price`, rejects an empty tab or
     mixed currencies
   - computes `extendHours`, excluding the check-in grant
3. **QR** `lib/bakong.ts`, `generateInvoiceQR` → `khqrFromSource` (Path 1) or
   `buildKhqr` (Path 2) → `lib/emv.ts` `dynamicFromStatic`. Five tags rewritten,
   CRC recomputed, `BakongKHQR.verify()` as a final check.
4. **Store** `lib/db.ts`, `createInvoice`: writes the invoice with
   `lines_json`, a fresh UUID, and `expires_at = now + 5 minutes`. The `UNIQUE`
   on md5 is caught and retried once.
5. **Browser** `components/khqr-payment.tsx`: renders the QR as an SVG, starts a
   1-second tick for the countdown and a 3-second poll for
   `/api/invoices/{id}/check`.
6. **Poll** `app/api/invoices/[id]/check/route.ts` → `lib/payments.ts`
   `settleIfPaid` → `lib/bakong.ts` `verifyTxByMd5` → Bakong Open API.
7. **Settle** `lib/db.ts`, `settleInvoicePaid`: in **one transaction**, mark
   `PAID`, flip the snapshot lines to `BILLED`, push `ends_at` forward.
8. **Re-render**: the poll returns `PAID`, `KhqrPayment` shows the tick and the
   reference, and the POS shows "Check out and close room".

The snapshot is the thing to explain if asked why a bill cannot be edited: the
invoice stores *which lines it paid*, so the bill is history. Order more
popcorn an hour later and it is `UNBILLED` and lands on the next bill.

### The extension subtlety

The **first** `ROOM_HOURS` line is the check-in grant, and its time is already
inside `ends_at`. Extending the stay by that line again would charge the guest
twice. `initialRoomLineId` finds it and the route excludes it from
`extendHours`. If someone asks why the first line is special, that is the answer.

---

## 8. Confirming payment, and the quota

File: `lib/payments.ts`.

The browser polls every 3 seconds. The server does the real work, because
**Bakong's Open API allows 100 md5 checks per token per day.** A screen that
polls every few seconds would burn that in minutes.

```ts
const MIN_GAP_MS = 15_000;         // between real checks, per invoice
const QUOTA_ERROR_CODE = 17;       // Bakong's "quota gone" code
```

- `lastCheck: Map<md5, timestamp>` spaces checks per invoice.
- `force: true` bypasses the gap, for one-off decisions that must ask now:
  cancel, expiry, re-billing.
- On error 17, `quotaBlockedUntil` is set to **midnight in Phnom Penh**
  (computed with a UTC+7 offset) and every check returns false until then.
- `live` and `quotaBlockedUntil` live on `globalThis`, so one throttle is shared
  across route bundles and dev reloads instead of being rebuilt per request.

`verifyTxByMd5` checks amount and currency as sanity checks. It deliberately
does **not** compare `toAccountId`, because a bank sub-account can settle through a
bridge account, so the destination does not match what you would expect.

### The edge cases that matter

- **Expiry**: when the TTL passes, `/check` forces one final lookup *before*
  expiring, so a payment made at 4:59 still settles.
- **Cancel**: `/cancel` does the same, so staff can never void a paid bill.
- **Cancel booking**: the route force-checks the open QR first and refuses with
  "The open QR was just paid. Review the bill before cancelling."
- **Invoice route retry**: the same force-check, so a late payment is settled
  instead of being billed twice.

All four are the same idea: **never let a paid bill be lost by a race.**

---

## 9. Each part, briefly

### Guest, `/t/[code]`

`page.tsx` is a server component that looks the room up and renders
`room-client.tsx`. The guest can order snacks, add time, and pay. It uses
`pendingInvoiceId` to resume an open QR. On phones the bill sits below the
menu, so a sticky bar keeps the total and the pay button in reach.

The pay button reads `Pay {money(unbilledTotal)} with KHQR`, a specific CTA
rather than "Submit".

### Staff POS, `/staff`

Room grid on the left, bill on the right. `Checkout` is a small state machine:

```
idle ──charge──▶ qr ──paid──▶ settled
                 └──expired──▶ settled
```

`canClose` is `unbilledTotal === 0 && checkout.kind !== "qr"`, so "Check out
and close room" cannot fire while a QR is open. After an expiry with money
still owed it offers "New KHQR for {total}".

### Admin, `/admin`

Three tabs: Rooms, Menu, History. Room **code** is read-only in the UI and the
`PATCH` route ignores it, because that code is printed on a QR card hanging on a
door. Changing it would break the card. Changing the name, rate or capacity is
fine.

### Admin, print card

Server component. Renders the room code large, a QR to `/t/A1`, and a
`window.print()` button. `APP_URL` pins the QR to one domain; unset, the page
infers the host from the request, so the same build prints correct codes on an
IP today and on a domain after DNS lands. `.no-print` hides the header and
footer in print.

### KHQR test bench, `/admin/khqr-test`

Section 6. Five variants, an amount box, a scanner, and it prints the exact
`.env` lines that produced the QR.

`currencyForSource` is a real detail: a currency named in `MERCHANT_KHQR_CURRENCIES`
is honoured, and so are ACLEDA dual-currency accounts (tag 39 containing `2CCY`).
Any other bank QR is kept in the currency it names, because overwriting it
produces a QR that looks right and fails.

### Components

- `ui.tsx`: `Button` (5 variants, 2 sizes), `Field` (56px, label above, hint and
  error wired through `aria-describedby`), `Notice`, `RoomStatusLabel`,
  `Wordmark`.
- `currency.tsx`: React context carrying `SHOP_CURRENCY` from the server, so
  changing it needs no rebuild. `useMoney()` returns a formatter that defaults to
  the shop currency but accepts an override for historical lines.
- `khqr-payment.tsx`: the QR, the countdown, the polling, the simulate and
  cancel buttons, and PNG export for customers paying on the same phone that
  shows the QR (bank apps scan the gallery, which needs PNG, not SVG).

---

## 10. The front end

- **Tailwind v4** with CSS-first tokens in `app/globals.css`, using `@theme`.
  Colours, radius scale, the one shadow tier, and two custom breakpoints
  (`md` 744px, `lg` 1128px).
- **Two WCAG contrast corrections** in the tokens, with the numbers in the
  comment. `#ff385c` on white text is 3.52:1, so buttons use `#e00b41` at
  4.89:1. The `#dddddd` hairline is 1.36:1, so form outlines use `#929292` at
  3.11:1.
- **One focus style everywhere**: a 2px ink ring at 15.9:1, and no
  `outline: none` anywhere.
- **Room status is never colour alone.** Free is an outline ring, in use is
  filled, and each has a word: "Free", "In use", "Cleaning". That is for
  colour-blind users and for anyone printing in black and white.
- **Inter** via `next/font`, which self-hosts it. It is the open substitute for
  a licensed display face the design called for.
- Light theme only, and the file says so.

---

## 11. Deployment

`Dockerfile` is three stages: `deps` runs `npm ci`, `builder` runs `npm run
build`, `runner` copies only what production needs. `railway.toml` points
Railway at it, with a healthcheck on `/`.

SQLite needs a writable path, so the runner creates `/data`, declares it as a
`VOLUME`, and sets `DATABASE_PATH=/data/app.db`. That volume is what makes the
database survive a redeploy.

`next.config.ts` needs `serverExternalPackages: ["better-sqlite3"]`, so Next.js
does not try to bundle a native module.

---

## 12. Question bank

Short answers. Say them in your own words.

### About the design

**Why KHQR instead of a card gateway?**
Khmer users pay with their banking apps, and KHQR is Cambodia's national
instant-payment standard. No card network, no chargeback, and the guest scans
with whatever app they already have.

**Why not store dollars as decimals?**
Float arithmetic produces `0.1 + 0.2 !== 0.3`, and that error lands in a QR
string a bank app compares as text. A rejected payment, not a rounding
difference.

**Why integers and not Decimal?**
TypeScript has no Decimal. Integers in minor units is the equivalent, and it is
exact.

**Why keep two KHQR libraries?**
NBC's official SDK generates the QR, because the community one writes timestamps
in seconds and strict bank apps reject that. The community client does the Open
API calls. Different jobs, different libraries.

**Why is `/admin/khqr-test` in the product?**
Because the correct layout is not documented anywhere. It is bank-specific, and
the only way to find it is to generate variants and scan them. The page is a
diagnostic tool that happens to be a customer of the payment layer.

**Why does the invoice store which lines it paid, not just a total?**
So a bill is history. If the guest orders more later, those items are still
`UNBILLED` and appear on the next bill. A stored total could not tell a paid
snack from an unpaid one.

**Why the 5-minute expiry?**
Stops a leaked QR from being paid hours later. The QR is a bill for a specific
total, and the total stops being true as soon as the guest adds more.

**What if the guest pays at 4:59?**
`/check` forces one final Bakong lookup at expiry before marking the invoice
expired, so it settles.

### About the code

**What is a route group, `(site)`?**
A folder that does not change the URL. It lets `app/(site)/layout.tsx` put the
header and footer on those pages, while `app/api/` and `app/staff/` sit outside
it and get a bare layout.

**What does `force-dynamic` do?**
Stops Next.js caching the route. Every API route has it, so room status and
invoice state are never served from a cache.

**What is a TLV string?**
Tag, length, value. Two digits of tag, two digits of length, then that many
characters. `parseTlv` walks it, `tlv()` builds a piece, and
`dynamicFromStatic` reuses the untouched pieces.

**What is CRC-16/CCITT-FALSE?**
A checksum EMV QR requires over the payload, including the `6304` marker. We
recompute it after rewriting tags, or bank apps reject the string.

**Why `globalThis` for the throttle?**
Next.js bundles routes separately, so a module-level `Map` would be rebuilt per
bundle. Storing it on `globalThis` gives one throttle across route bundles and
dev reloads.

**What does `settleInvoicePaid` do in one transaction?**
Marks the invoice `PAID`, flips the snapshot lines to `BILLED`, and pushes
`ends_at` forward. All three or none, so a paid bill can never leave its lines
still unbilled.

**Why is the room code not editable?**
It is printed on a QR card on the door. Changing it would break every printed
card. The `PATCH` route ignores the field entirely.

**How does the guest's page know the room?**
The URL, `/t/A1`. The server component looks up the code, and the client
component fetches `/api/rooms/by-code/A1` for the live tab.

### About the process

**How did you test it?**
`tsc --noEmit` and `eslint` pass, and we clicked through the POS, the guest
view, the KHQR test bench and the print card. There are **no automated tests**,
which is the main gap in this project.

**What bugs did you hit?**
The three hardest were all KHQR, not code: strict bank apps rejecting the
community SDK's second-precision timestamps, a USD-only account refusing a KHR
QR at account inquiry, and tag 29 versus tag 30 for a shared Bakong ID. None of
them are visible in the source, which is why the test bench exists.

**Did you use AI?**
This is your group's call. An honest answer is safest: say what you used it for
and that you checked and understood the result.

**How would you deploy it?**
Already set up: `Dockerfile` and `railway.toml`, SQLite on a `/data` volume,
`DATABASE_PATH` pointing inside it, healthcheck on `/`. You would need to add
authentication first, and set `BAKONG_TOKEN` as a Railway secret.

---

## 13. Weak spots: know these before someone asks

Say these plainly. Admitting a known limit sounds far better than being caught
out.

| Weak spot | Honest answer |
|---|---|
| **No authentication at all** | There is no login anywhere. `/admin` and `/staff` are open to anyone who reaches the server. The fix is a session guard on those routes, and it should be done before any public deploy. |
| **No automated tests** | Only `tsc` and `eslint` run in CI terms. The pure functions in `lib/emv.ts` and `lib/money.ts` are the easiest to test first. |
| **The 100-checks-per-day quota** | A busy day exhausts it and payments stop auto-confirming until midnight. A real system needs a webhook or a bulk reconciliation, which this public API does not offer. |
| **`/admin` is public** | Same as the first row. Room rates, menu prices and booking history are all readable. |
| **SQLite** | Fine for one cinema. For many simultaneous users, move to PostgreSQL. `lib/db.ts` is the only file to change. |
| **One bill per booking, one currency** | Staff can charge in either riel or dollars, but a booking is settled by one invoice in one currency. There is no part-payment, and a booking whose unbilled lines span two currencies is refused. |
| **The 4,000 rate is fixed** | A constant in `lib/money.ts`, not a live market rate. Rounding is always up, so the shop is never short, and a small bill can pick up a little rounding. |
| **Prices are hand-set** | There is no peak-hour pricing or occupancy-based rates. Hourly rate is one number per room. |
| **`convertMinor` uses a fixed 4000** | Only used when re-pricing after a `SHOP_CURRENCY` change, never for a live payment, so the rate being approximate is not a payment risk. |
| **Khmer UI text** | The interface is in English. Khmer would be the next thing to do. |

---

## 14. Commands to know

```
npm install                 # install packages
npm run dev                 # start at http://localhost:3000
npm run build               # production build
npm start                   # serve the production build
npm run lint                # eslint
npx tsc --noEmit            # type check, no output means clean
```

Setup:

```
cp .env.example .env.local  # then fill it in
```

Demo mode needs no Bakong account: with no `BAKONG_TOKEN`, the payment screen
shows a **Simulate** button that marks an invoice paid without moving money.

Live mode needs `BAKONG_TOKEN` from the Bakong developer portal. With a token
set, simulation is off unless `SIMULATE_PAYMENTS=true` is set again on purpose.

---

## 15. Practice plan (about 2 hours)

1. **Run it** (15 min): `npm run dev`, then walk a booking end to end. Check a
   guest into A1, add popcorn, charge, simulate, check out, mark the room ready.
2. **Read in this order** (60 min), with this guide open:
   `lib/money.ts` → `lib/emv.ts` → `lib/bakong.ts` → `lib/payments.ts` →
   `lib/db.ts` (`createInvoice` and `settleInvoicePaid`) →
   `app/api/bookings/[id]/invoices/route.ts` → `components/khqr-payment.tsx` →
   `app/(site)/admin/khqr-test/page.tsx`.
3. **Decode a real QR** (10 min): open `/admin/khqr-test`, use the scanner on
   a receive-money code from ACLEDA, ABA and your Bakong wallet, and read the
   fields. Compare tag 29 or 30, the bank's private tag (39, 40, 42), and tag 53
   against the POS variant. This is the single most useful ten minutes you can
   spend.
4. **Break something on purpose** (10 min): set `SHOP_CURRENCY=USD` with a KHR
   source QR, restart, and see the currency-mismatch error. Then set
   `MIN_GAP_MS` in `lib/payments.ts` to `15_000_000` and watch the payment
   screen stop confirming. Change both back.
5. **Explain section 7 out loud** without reading, then answer the questions in
   section 12 with the answers covered.

---

## 16. Glossary

| Term | Meaning |
|---|---|
| KHQR | Khmer QR, Cambodia's national instant-payment standard |
| EMV TLV | Tag, length, value: how a QR string is encoded |
| PoIM | Point of Initiation Method, tag `01`; 11 static, 12 dynamic |
| md5 | The hash Bakong indexes a transaction by, and what we poll |
| Minor units | Cents, or whole riel; how money is stored |
| CRC-16/CCITT-FALSE | The checksum EMV QR requires, computed over the payload plus `6304` |
| Force-dynamic | Tells Next.js not to cache a route |
| Route group | A folder like `(site)` that does not change the URL |
| Server component | Renders on the server only; the default in Next.js |
| Client component | `"use client"`, runs in the browser, can poll and hold state |
| Route handler | `app/api/**/route.ts`; a `GET` or `POST` that returns JSON |
| Transaction | Several writes that all succeed or all roll back |
| Snapshot | The list of tab lines an invoice paid, stored in `lines_json` |
| WAL | Write-Ahead Logging, SQLite's faster and safer journal mode |
| `globalThis` | Shared state across route bundles and dev reloads |
| jsQR | The library that reads a QR from the phone camera in the test bench |
| ACLEDA | Cambodian bank; its own QR only opens in its app, ABA rejects it |
| `2CCY` | Tag 39 marker on ACLEDA dual-currency accounts; accepts KHR or USD |
| `bkrt` | Bakong wallet suffix in `name@bkrt`; the QR that every bank app opens |
| `MERCHANT_KHQR_CURRENCIES` | Env list of currencies the account takes, e.g. `KHR,USD` |
