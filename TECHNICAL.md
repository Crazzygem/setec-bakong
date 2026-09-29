# Technical Notes

Reference for the Bakong KHQR cinema room project. Written from the source, so
every detail here can be checked against the code.

## What the system does

Private cinema rooms booked by the hour with a running tab, paid by scanning a
Bakong KHQR code. Next.js 15 App Router, React 19, TypeScript, Tailwind v4, and
SQLite through better-sqlite3.

The interesting part is not the CRUD. It is the payment layer, because a KHQR
QR is not a link you can generate from a total. It has to match how the
receiving bank registered the account.

## Data model

Five tables, created on first connection in `lib/db.ts`:

| Table | Columns that matter |
|---|---|
| `rooms` | `code`, `name`, `hourly_rate`, `capacity`, status `AVAILABLE` / `OCCUPIED` / `CLEANING` |
| `menu_items` | `name`, `price`, `available` |
| `bookings` | `room_id`, `customer_name`, `ends_at`, status `ACTIVE` / `CLOSED` / `CANCELLED` |
| `tab_items` | `kind` (`ROOM_HOURS` or `SNACK`), `qty`, `unit_price`, `currency`, state `UNBILLED` / `BILLED` / `VOID` |
| `invoices` | `total`, `currency`, `qr`, `md5`, status, `lines_json`, `expires_at` |

There is a real migration path. An earlier version of the schema priced
everything in riel with `*_khr` columns. `user_version` gates the schema, and
`migrateFromKhrOnly` renames those columns and adds `currency`, so existing data
survives.

SQLite runs in WAL mode with foreign keys on. The five rooms and six menu items
are seeded only when their tables are empty, so admin edits survive restarts.

## Money handling

Amounts are stored as integers in the currency's minor unit. US cents are two
digits, riel is zero digits, so `DIGITS = { USD: 2, KHR: 0 }`. Nothing in the
database is a float.

That matters beyond tidiness. `minorToMajor` runs its result through `toFixed`
to strip float noise such as `0.30000000000000004` before the value enters the
QR amount field. A bank app validating a string amount would reject that.

Each tab line and each invoice carries its own currency, in addition to the
shop-wide `SHOP_CURRENCY`. This is deliberate. Switch the shop to USD and
already-closed bills must still show the riel they were charged in.
`syncPriceCurrency` re-prices rooms, the menu, and only `UNBILLED` lines when
the shop currency changes. The invoice route refuses to build a bill whose
unbilled lines mix currencies, which can only happen on a booking that predates
a currency change.

### Charging in the other currency

Staff pick the currency at the till, so a guest who asks to pay in dollars is
not turned away. The tab is priced in the shop currency and converted once, in
`toBillAmount` in `lib/money.ts`, at 4,000 riel to the dollar.

The price is always rounded **up**, and a riel price is always a whole 100, so:

- `៛3,300` is $0.825, charged as **$0.83**, 20 riel extra
- `$0.83` is ៛3,320, charged as **៛3,400**, 80 riel extra

Rounding up means the shop is never short and the guest is never charged below
the rate. The worst case is 20 riel going to dollars, and 99 riel coming the
other way, both under half a cent.

`toBillAmount` is separate from `convertMinor` on purpose. `convertMinor` is
used when re-pricing the menu after a currency change, and it has a $1.00 floor
that would turn a $0.75 tab into a $1.00 charge. A billing function must never
inflate a small bill, so it has no floor, only a 1 cent minimum.

`1e-9` appears in both `Math.ceil` calls because `83 * 40` can land at
`3300.0000000000005`, which would round a whole extra step. The epsilon makes an
exact figure stay exact.

## KHQR generation

A KHQR code is an EMV TLV string: a two-digit tag, a two-digit length, then
that many characters. `lib/emv.ts` parses and rebuilds that structure directly.

There are two ways to produce a bill, and the choice is the heart of the
problem.

### Path 1: copy a static QR

Paste the receive-money QR string of a Bakong wallet into
`MERCHANT_KHQR_SOURCE`. `dynamicFromStatic` then rewrites only five tags:

| Tag | What it becomes |
|---|---|
| `01` | `11` (static) becomes `12` (dynamic), so the app uses the amount |
| `53` | currency, `840` for USD or `116` for KHR |
| `54` | the amount |
| `62` | sub-tag `01`, the bill number |
| `99` | sub-tags `00` and `01`, initiated and expiry timestamps in milliseconds |

Everything else, including every account tag the bank routes on, is preserved
byte for byte. The CRC is recomputed as CRC-16/CCITT-FALSE over the payload
including the `6304` marker.

Which static QR to copy matters, and it was found by scanning, not from the docs.
Decoding QRs from three apps showed that ACLEDA, ABA and Wing all issue the same
shape, tag `29` with the bank's shared ID, an account and the bank name, plus a
private tag of their own (ACLEDA `39` `2CCY`, ABA `40`, Wing `42`, all "Dual"). That
shape routes inside the issuing bank: an ACLEDA-issued bill opened in ACLEDA and was
rejected as an invalid QR by ABA. Stripping tag `39` did not change that. A bare
Bakong wallet ID (`name@bkrt`, tag `29` with sub-tag `00` only) opened in both ABA and
ACLEDA, and the money is credited straight to the Bakong wallet.

A Bakong wallet holds both KHR and USD, and each bill's tag `53` picks which one is
credited. The wallet's QR names only KHR, so `MERCHANT_KHQR_CURRENCIES=KHR,USD` tells
the currency check that both are allowed. Without it a source with no `2CCY` is
treated as single-currency.

### Path 2: build it from merchant fields

Without `MERCHANT_KHQR_SOURCE`, NBC's official SDK builds the QR from the Bakong
ID, account, and acquiring bank. This is the fragile path, because a bank app
rejects the QR if the layout does not match how that bank registered the
account.

`/admin/khqr-test` exists for this. It generates five variants side by side,
including one that drops the bank name and one that flips tag 29 to tag 30, and
decodes a scanned code so you can see the fields the app actually read.

### Two details that look arbitrary

Tag `29` is an individual account, tag `30` is a merchant ID. A shared ID such
as `khqr@aclb` may be registered either way, so `MERCHANT_KHQR_LAYOUT` matters
and there is no way to know without testing against the app.

`SHOP_CURRENCY` must match what the receiving account accepts. A USD-only
account rejects a KHR QR during account inquiry. It presents as "the QR will not
scan" when it is really a currency mismatch. A Bakong wallet takes both, declared
with `MERCHANT_KHQR_CURRENCIES`.

### Library choice

QR generation uses NBC's official SDK, not the community `bakong-khqr` package,
because the community one writes tag-99 timestamps in seconds and strict bank
apps reject that. The community package is still used for the Open API calls.

The `md5` for the source path is computed locally as an MD5 of the QR string,
which is the identifier Bakong indexes. The rebuilt string is verified with
`BakongKHQR.verify()` before it is returned, so it is built with our own EMV
code and validated with the official library.

## Confirming payment

Staff confirm payments by hand. The staff screen has two buttons under the QR.
**Check payment with Bakong** POSTs `/api/invoices/[id]/verify`, which makes exactly one
`verifyTxByMd5` call, settles the invoice if Bakong has the transfer, and reports
"no payment yet" otherwise (error 17, the daily limit, returns a message pointing at the
other button). Nothing calls it on a timer. **Confirm payment received** POSTs `/api/invoices/[id]/approve`, which runs `settleInvoicePaid`
(after a browser confirm dialog) and refuses an invoice that is not `PENDING` or has
passed its TTL.

The browser polls `/api/invoices/[id]/check` every 3 seconds, and ticks a
1-second local timer purely for the countdown display. `/check` reads the local
database only: it reports the status and marks the invoice `EXPIRED` once the TTL
passes. It never calls Bakong, so polling is free.

This replaced automatic confirmation. The old version called Bakong's
`check_transaction_by_md5` on every poll (throttled to one call per invoice every
15 seconds) and still used up the API's 100-checks-per-token-per-day limit without
confirming a payment. Cancel, expiry and re-billing no longer look anything up either.

`verifyTxByMd5` is used only by the Check button and the `/admin/khqr-test` page; each
click costs one call. It checks amount and currency
and deliberately does not compare `toAccountId`, because a bank sub-account can settle
through a bridge account.

The trade-off: the guest is not confirmed until staff press the button, and a payment
made just before the five-minute TTL can expire before staff confirm it. Staff should
confirm promptly, and make a new QR if it has closed.

## The invoice snapshot

When staff raise a bill, the route stores which lines are being paid, not just a
total:

```json
{ "tabItemIds": ["...", "..."], "extendHours": 2 }
```

`settleInvoicePaid` then does three things in one SQLite transaction: mark the
invoice `PAID`, flip those lines to `BILLED`, and push `ends_at` forward. The
bill is immutable history. Order more popcorn an hour later and those items are
`UNBILLED` and appear on the next bill.

There is a subtlety in the extension math. The first `ROOM_HOURS` line is the
check-in grant, and that time is already inside `ends_at`, so it must not extend
the stay again. `initialRoomLineId` finds it and excludes it from `extendHours`.

Two other protections in that route: retrying returns the still-open QR instead
of minting a second bill. An expired invoice is closed before a new one is created.

## Demo mode

There is no separate demo mode. The Confirm payment received button works with or
without a `BAKONG_TOKEN`, so a class demo can press it without moving any money.

## Deployment

`Dockerfile` is a three-stage build and `railway.toml` points Railway at it.
SQLite lives on a `/data` volume with `DATABASE_PATH` pointing inside it.
`APP_URL` pins printed door QR codes to one domain; unset, the print page infers
from the request host, so the same build works on an IP today and on a domain
after DNS lands.

## Known limitations

**No authentication anywhere.** I grepped for it and there is none, so `/admin`
and `/staff` are open to anyone who can reach the server. This is the most
likely thing to be flagged in review. Present it as known scope for a class
project, and put it behind a private network or an access proxy before any
public deploy.

**Payments are confirmed by hand.** The Bakong API allows only 100 md5 checks per
token per day, so automatic confirmation ran out of quota without confirming anything
and was removed. The button has no authentication, like the rest of `/staff`, and
trusts the staff member. A production system would need a webhook or a bulk
reconciliation, neither of which this public API offers here.

## Questions to expect

**Why not store dollars as decimals?**
Float arithmetic produces `0.1 + 0.2 !== 0.3`, and that error lands in a QR
string a bank app compares as text.

**Why not use the community KHQR package for everything?**
Tag-99 timestamps in seconds, which strict bank apps reject. NBC's official SDK
is used for generation; the community client is kept only for Open API calls.

**What if two people pay the same invoice?**
`md5` is `UNIQUE` and the invoice ID is a UUID, so a collision is nearly
impossible. The create loop carries a single retry to cover it anyway.

**How do you know the right KHQR layout?**
You do not know from documentation, you test. That is the reason
`/admin/khqr-test` exists, and it is the most defensible part of the project
because it is empirical. It is how we found that a bank-routed QR (ACLEDA's) is
rejected by ABA while a bare Bakong wallet QR opens in both.

**Is the payment secure?**
A payment is confirmed by an md5 lookup against Bakong, not by trusting the
browser. The browser only ever asks "has this been paid", and the answer comes
from Bakong.
