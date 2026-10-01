"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMoney, useShopCurrency } from "@/components/currency";
import { KhqrPayment } from "@/components/khqr-payment";
import {
  Button,
  Field,
  Notice,
  RoomStatusLabel,
  Wordmark,
  type RoomStatus,
} from "@/components/ui";
import { toBillAmount, type Currency } from "@/lib/money";

interface Room {
  id: string;
  code: string;
  name: string;
  hourly_rate: number;
  capacity: number;
  status: RoomStatus;
  image_url: string | null;
}
interface Booking {
  id: string;
  customer_name: string;
  ends_at: number;
}
interface TabLine {
  id: string;
  kind: "ROOM_HOURS" | "SNACK";
  label: string;
  qty: number;
  unit_price: number;
  currency: Currency;
  state: "UNBILLED" | "BILLED" | "VOID";
}
interface MenuItem {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
}
interface Detail {
  room: Room;
  booking: Booking | null;
  tab: TabLine[];
  unbilledTotal: number;
  menu: MenuItem[];
  pendingInvoiceId: string | null;
}

type Checkout =
  | { kind: "idle" }
  | { kind: "qr"; invoiceId: string }
  | { kind: "settled"; invoiceId: string; status: "PAID" | "EXPIRED" };

function timeLeft(endsAt: number, now: number): string {
  const m = Math.round((endsAt - now) / 60_000);
  if (m <= 0) return "time is up";
  return m >= 60
    ? `${Math.floor(m / 60)} h ${m % 60} min left`
    : `${m} min left`;
}

const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const postJson = (url: string, body?: object) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export default function StaffPos() {
  const money = useMoney();
  const shop = useShopCurrency();
  // Staff pick the currency to charge in. Defaults to the shop currency, and only matters
  // when the guest asks to pay in the other one.
  const [chargeCurrency, setChargeCurrency] = useState<Currency | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [roomsError, setRoomsError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [checkout, setCheckout] = useState<Checkout>({ kind: "idle" });
  const [name, setName] = useState("");
  const [hours, setHours] = useState(2);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Drops responses for a room the cashier has already clicked away from.
  const selectSeq = useRef(0);
  const selectedCode = useRef<string | null>(null);

  const loadRooms = useCallback(async () => {
    try {
      const res = await fetch("/api/rooms");
      if (!res.ok) throw new Error();
      setRooms((await res.json()).rooms ?? []);
      setRoomsError(false);
    } catch {
      setRoomsError(true);
    }
  }, []);

  const fetchDetail = useCallback(
    async (code: string): Promise<Detail | null> => {
      const res = await fetch(
        `/api/rooms/by-code/${encodeURIComponent(code)}`,
      ).catch(() => null);
      return res?.ok ? res.json() : null;
    },
    [],
  );

  useEffect(() => {
    selectedCode.current = detail?.room.code ?? null;
  }, [detail]);

  const refreshDetail = useCallback(async () => {
    const code = selectedCode.current;
    if (!code) return;
    const seq = selectSeq.current;
    const d = await fetchDetail(code);
    if (d && seq === selectSeq.current) setDetail(d);
    return d;
  }, [fetchDetail]);

  // Customers order and start KHQRs from their phones, so the poll surfaces those too.
  const poll = useCallback(async () => {
    loadRooms();
    const d = await refreshDetail();
    if (d?.pendingInvoiceId) {
      const id = d.pendingInvoiceId;
      setCheckout((c) =>
        c.kind === "idle" ? { kind: "qr", invoiceId: id } : c,
      );
    }
  }, [loadRooms, refreshDetail]);

  useEffect(() => {
    loadRooms();
    const timer = setInterval(poll, 5000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(timer);
      clearInterval(tick);
    };
  }, [loadRooms, poll]);

  async function selectRoom(room: Room) {
    const seq = ++selectSeq.current;
    setSelectedId(room.id);
    setMsg(null);
    setNotice(null);
    setConfirmCancel(false);
    setDetail(null);
    setCheckout({ kind: "idle" });
    const d = await fetchDetail(room.code);
    if (seq !== selectSeq.current) return;
    if (!d) {
      setMsg(`Room ${room.code} could not load. Pick it again to retry.`);
      return;
    }
    setDetail(d);
    // Resume an open QR rather than billing again.
    if (d.pendingInvoiceId)
      setCheckout({ kind: "qr", invoiceId: d.pendingInvoiceId });
  }

  async function run(
    fn: () => Promise<Response>,
  ): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setMsg(null);
    setNotice(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error ?? "That did not work. Try again.");
        return null;
      }
      return data;
    } catch {
      setMsg("No connection to the server. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function checkIn() {
    if (!detail) return;
    const ok = await run(() =>
      postJson("/api/bookings", {
        roomId: detail.room.id,
        customerName: name.trim() || "Walk-in",
        hours,
      }),
    );
    if (!ok) return;
    setName("");
    setHours(2);
    await Promise.all([refreshDetail(), loadRooms()]);
  }

  async function addItem(body: object) {
    if (!detail?.booking) return;
    await run(() =>
      postJson(`/api/bookings/${detail.booking!.id}/items`, body),
    );
    await refreshDetail();
  }

  async function removeLine(itemId: string) {
    if (!detail?.booking) return;
    await run(() =>
      fetch(`/api/bookings/${detail.booking!.id}/items/${itemId}`, { method: "DELETE" }),
    );
    await refreshDetail();
  }

  async function charge() {
    if (!detail?.booking) return;
    const data = await run(() =>
      postJson(`/api/bookings/${detail.booking!.id}/invoices`, {
        currency: chargeCurrency ?? shop,
      }),
    );
    const inv = data?.invoice as { id: string } | undefined;
    if (inv) setCheckout({ kind: "qr", invoiceId: inv.id });
    else await refreshDetail();
  }

  async function closeRoom() {
    if (!detail?.booking) return;
    if (
      !(await run(() => postJson(`/api/bookings/${detail.booking!.id}/close`)))
    )
      return;
    setCheckout({ kind: "idle" });
    setNotice(`${detail.room.code} is checked out and waiting for cleaning.`);
    await Promise.all([refreshDetail(), loadRooms()]);
  }

  async function cancelBooking() {
    if (!detail?.booking) return;
    const data = await run(() =>
      postJson(`/api/bookings/${detail.booking!.id}/cancel`),
    );
    setConfirmCancel(false);
    if (!data) {
      await refreshDetail();
      return;
    }
    setCheckout({ kind: "idle" });
    const paid = (data.paid as { total: number; currency: Currency }[]) ?? [];
    setNotice(
      paid.length > 0
        ? `Booking cancelled. ${paid.map((p) => money(p.total, p.currency)).join(" and ")} was already paid by KHQR: refund it to the customer by hand.`
        : `Booking cancelled. ${detail.room.code} is free again.`,
    );
    await Promise.all([refreshDetail(), loadRooms()]);
  }

  async function markCleaned() {
    if (!detail) return;
    if (!(await run(() => postJson(`/api/rooms/${detail.room.id}/ready`))))
      return;
    setNotice(`${detail.room.code} is free for the next guest.`);
    await Promise.all([refreshDetail(), loadRooms()]);
  }

  const onSettled = useCallback(
    (status: "PAID" | "EXPIRED") => {
      setCheckout((c) =>
        c.kind === "qr"
          ? { kind: "settled", invoiceId: c.invoiceId, status }
          : c,
      );
      refreshDetail();
    },
    [refreshDetail],
  );

  const room = detail?.room ?? null;
  const occupied = room?.status === "OCCUPIED" && !!detail?.booking;
  const qrOpen = checkout.kind === "qr";
  const freeCount = rooms?.filter((r) => r.status === "AVAILABLE").length ?? 0;
  const paidSoFar = detail?.tab.filter((l) => l.state === "BILLED") ?? [];

  return (
    <div className="flex min-h-dvh flex-col bg-canvas lg:h-dvh">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-hairline px-4 md:px-6">
        <div className="flex min-w-0 items-baseline gap-3">
          <Wordmark />
          <span className="hidden truncate text-sm text-muted md:inline">
            Counter
            {rooms ? ` · ${freeCount} of ${rooms.length} rooms free` : ""}
          </span>
        </div>
        <nav
          aria-label="Staff"
          className="flex items-center gap-5 text-sm font-semibold"
        >
          <Link
            href="/admin"
            className="flex min-h-11 items-center text-muted hover:text-ink"
          >
            Admin
          </Link>
        </nav>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[232px_minmax(0,1fr)_400px]">
        {/* Rooms: a scrolling strip on phones and tablets, a column on desktop. */}
        <nav
          aria-label="Rooms"
          className="shrink-0 border-b border-hairline lg:overflow-y-auto lg:border-r lg:border-b-0"
        >
          <h2 className="px-4 pt-3 text-sm font-semibold text-muted md:px-6 lg:px-5 lg:pt-5">
            Rooms
          </h2>
          {roomsError && !rooms && (
            <p className="px-4 py-2 text-sm text-error md:px-6 lg:px-5">
              Rooms could not load. Retrying…
            </p>
          )}
          {!rooms && !roomsError && (
            <p className="px-4 py-2 text-sm text-muted md:px-6 lg:px-5">
              Loading rooms…
            </p>
          )}
          {rooms?.length === 0 && (
            <p className="px-4 py-2 text-sm text-muted md:px-6 lg:px-5">
              No rooms yet.{" "}
              <Link href="/admin" className="font-medium text-ink underline">
                Add one in Admin
              </Link>
              .
            </p>
          )}
          <ul className="flex gap-2 overflow-x-auto px-4 pt-2 pb-3 md:px-6 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-5">
            {rooms?.map((r) => {
              const active = r.id === selectedId;
              return (
                <li key={r.id} className="shrink-0">
                  <button
                    onClick={() => selectRoom(r)}
                    aria-current={active ? "true" : undefined}
                    className={`flex min-h-11 w-full items-center gap-3 rounded-full border px-4 py-2 text-left lg:justify-between lg:rounded-none lg:border-0 lg:border-l-2 lg:px-5 lg:py-3 ${
                      active
                        ? "border-ink bg-surface-strong lg:border-l-ink"
                        : "border-hairline hover:bg-surface-soft lg:border-l-transparent"
                    }`}
                  >
                    {r.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.image_url}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-sm object-cover"
                      />
                    )}
                    <span>
                      <span className="block font-semibold">{r.code}</span>
                      <span className="hidden text-sm text-muted lg:block">
                        {r.name}
                      </span>
                    </span>
                    <RoomStatusLabel
                      status={r.status}
                      className="ml-auto text-body"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(0,1fr)_360px] lg:contents">
          <main className="min-w-0 px-4 py-6 md:px-6 lg:overflow-y-auto lg:px-8">
            {msg && (
              <div className="mb-4">
                <Notice tone="error">{msg}</Notice>
              </div>
            )}
            {notice && (
              <div className="mb-4">
                <Notice>{notice}</Notice>
              </div>
            )}

            {!selectedId && (
              <div className="grid min-h-48 place-items-center text-center lg:h-full">
                <p className="max-w-xs text-body">
                  Pick a room to check a guest in, add to their bill, or take
                  payment.
                </p>
              </div>
            )}
            {selectedId && !room && !msg && (
              <p className="text-muted">Loading room…</p>
            )}

            {room && (
              <div className="flex items-end justify-between gap-4 border-b border-hairline-soft pb-5">
                <div className="flex min-w-0 items-center gap-4">
                  {room.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={room.image_url}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-md object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm text-muted">{room.name}</p>
                    <h1 className="mt-1 truncate text-[22px] leading-tight font-medium">
                      {occupied
                        ? detail!.booking!.customer_name
                        : room.status === "CLEANING"
                          ? "Needs cleaning"
                          : "Free"}
                    </h1>
                    {occupied && (
                      <p className="mt-1 text-sm text-body">
                        Until {clock(detail!.booking!.ends_at)} ·{" "}
                        {timeLeft(detail!.booking!.ends_at, now)}
                      </p>
                    )}
                  </div>
                </div>
                <span className="text-5xl leading-none font-bold tracking-tight">
                  {room.code}
                </span>
              </div>
            )}

            {room?.status === "AVAILABLE" && (
              <section
                className="mt-6 max-w-md space-y-5"
                aria-label="Check in"
              >
                <Field
                  id="guest"
                  label="Guest name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Walk-in"
                  autoComplete="off"
                />
                <div>
                  <p
                    className="text-sm font-medium text-muted"
                    id="hours-label"
                  >
                    Hours
                  </p>
                  <div
                    className="mt-1 flex items-center gap-3"
                    role="group"
                    aria-labelledby="hours-label"
                  >
                    <button
                      type="button"
                      onClick={() => setHours((h) => Math.max(1, h - 1))}
                      disabled={hours <= 1}
                      aria-label="One hour less"
                      className="grid h-11 w-11 place-items-center rounded-full border border-field text-lg hover:border-ink disabled:border-hairline disabled:text-field"
                    >
                      −
                    </button>
                    <span
                      className="w-12 text-center text-lg font-semibold tabular-nums"
                      aria-live="polite"
                    >
                      {hours} h
                    </span>
                    <button
                      type="button"
                      onClick={() => setHours((h) => Math.min(12, h + 1))}
                      disabled={hours >= 12}
                      aria-label="One hour more"
                      className="grid h-11 w-11 place-items-center rounded-full border border-field text-lg hover:border-ink disabled:border-hairline disabled:text-field"
                    >
                      +
                    </button>
                    <span className="ml-auto text-lg font-semibold tabular-nums">
                      {money(hours * room.hourly_rate)}
                    </span>
                  </div>
                </div>
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={checkIn}
                  disabled={busy}
                >
                  Check in {name.trim() || "walk-in guest"}
                </Button>
                <p className="text-sm text-muted">
                  The room hours go on the bill. Take payment from the bill
                  panel.
                </p>
              </section>
            )}

            {room?.status === "CLEANING" && (
              <section className="mt-6 max-w-md" aria-label="Cleaning">
                <p className="text-body">
                  The last guest has checked out. Free the room once it is
                  clean.
                </p>
                <Button
                  className="mt-5"
                  variant="secondary"
                  onClick={markCleaned}
                  disabled={busy}
                >
                  Mark {room.code} clean and free
                </Button>
              </section>
            )}

            {occupied && (
              <section className="mt-6" aria-label="Add to bill">
                {qrOpen && (
                  <div className="mb-5">
                    <Notice>
                      A KHQR is waiting for payment. Anything added now goes on
                      the next bill.
                    </Notice>
                  </div>
                )}
                <h2 className="text-base font-semibold">Snacks and drinks</h2>
                {detail!.menu.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">
                    The menu is empty.{" "}
                    <Link
                      href="/admin"
                      className="font-medium text-ink underline"
                    >
                      Add items in Admin
                    </Link>
                    .
                  </p>
                ) : (
                  <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3">
                    {detail!.menu.map((m) => (
                      <button
                        key={m.id}
                        onClick={() =>
                          addItem({ kind: "SNACK", menuItemId: m.id, qty: 1 })
                        }
                        disabled={busy}
                        className="flex items-center gap-3 overflow-hidden rounded-md border border-hairline bg-canvas p-2 text-left transition-shadow hover:shadow-float active:bg-surface-soft disabled:opacity-60"
                      >
                        {m.image_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.image_url}
                            alt=""
                            className="h-14 w-14 shrink-0 rounded-sm object-cover"
                          />
                        )}
                        <span className="min-w-0">
                          <span className="block font-medium">{m.name}</span>
                          <span className="block text-sm text-muted tabular-nums">
                            + {money(m.price)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <h2 className="mt-8 text-base font-semibold">Extend stay</h2>
                <div className="mt-3 flex flex-wrap gap-3">
                  {[1, 2].map((h) => (
                    <button
                      key={h}
                      onClick={() => addItem({ kind: "ROOM_HOURS", hours: h })}
                      disabled={busy}
                      className="min-h-[72px] min-w-[148px] rounded-md border border-hairline bg-canvas p-4 text-left transition-shadow hover:shadow-float active:bg-surface-soft disabled:opacity-60"
                    >
                      <span className="block font-medium">
                        {h} more hour{h > 1 ? "s" : ""}
                      </span>
                      <span className="block text-sm text-muted tabular-nums">
                        + {money(h * room!.hourly_rate)}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="mt-10 border-t border-hairline-soft pt-5">
                  {confirmCancel ? (
                    <div
                      className="rounded-md border border-error p-4"
                      role="alertdialog"
                      aria-labelledby="cancel-title"
                    >
                      <p id="cancel-title" className="font-semibold">
                        Cancel {detail!.booking!.customer_name}&apos;s booking?
                      </p>
                      <p className="mt-1 text-sm text-body">
                        Unpaid items are dropped, any open QR is closed, and{" "}
                        {room!.code} becomes free.
                        {paidSoFar.length > 0 &&
                          " Money already paid by KHQR must be refunded by hand."}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={cancelBooking}
                          disabled={busy}
                        >
                          Yes, cancel booking
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setConfirmCancel(false)}
                          autoFocus
                        >
                          Keep booking
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="tertiary-danger"
                      size="sm"
                      onClick={() => setConfirmCancel(true)}
                    >
                      Cancel this booking
                    </Button>
                  )}
                </div>
              </section>
            )}
          </main>

          <aside
            aria-label="Bill"
            className="flex min-h-0 flex-col border-t border-hairline md:border-t-0 md:border-l lg:overflow-hidden"
          >
            {occupied ? (
              <BillPanel
                detail={detail!}
                checkout={checkout}
                busy={busy}
                chargeCurrency={chargeCurrency ?? shop}
                onChargeCurrency={setChargeCurrency}
                onCharge={charge}
                onClose={closeRoom}
                onSettled={onSettled}
                onCancel={() => setCheckout({ kind: "idle" })}
                onDone={() => setCheckout({ kind: "idle" })}
                onRemoveLine={removeLine}
              />
            ) : (
              <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted">
                {room
                  ? "No open bill for this room."
                  : "The bill and payment QR appear here."}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function BillPanel({
  detail,
  checkout,
  busy,
  chargeCurrency,
  onChargeCurrency,
  onCharge,
  onClose,
  onSettled,
  onCancel,
  onDone,
  onRemoveLine,
}: {
  detail: Detail;
  checkout: Checkout;
  busy: boolean;
  chargeCurrency: Currency;
  onChargeCurrency: (c: Currency | null) => void;
  onCharge: () => void;
  onClose: () => void;
  onSettled: (s: "PAID" | "EXPIRED") => void;
  onCancel: () => void;
  onDone: () => void;
  onRemoveLine: (itemId: string) => void;
}) {
  const money = useMoney();
  const shop = useShopCurrency();
  const unbilled = detail.tab.filter((l) => l.state === "UNBILLED");
  const billed = detail.tab.filter((l) => l.state === "BILLED");
  const canClose = detail.unbilledTotal === 0 && checkout.kind !== "qr";
  // The tab is priced in the shop currency; charging the other one converts it.
  const tabCurrency = unbilled[0]?.currency ?? shop;
  const converted = toBillAmount(
    detail.unbilledTotal,
    tabCurrency,
    chargeCurrency,
  );

  if (checkout.kind !== "idle") {
    return (
      <KhqrPayment
        key={checkout.invoiceId}
        invoiceId={checkout.invoiceId}
        onSettled={onSettled}
        onCancel={onCancel}
        staff
        settledFooter={
          checkout.kind === "settled" && (
            <>
              {canClose && (
                <Button className="w-full" onClick={onClose} disabled={busy}>
                  Check out and close room
                </Button>
              )}
              {checkout.status === "EXPIRED" && detail.unbilledTotal > 0 && (
                <Button className="w-full" onClick={onCharge} disabled={busy}>
                  New KHQR for {money(converted.total, chargeCurrency)}
                </Button>
              )}
              <Button
                className="w-full"
                variant={canClose || (checkout.status === "EXPIRED" && detail.unbilledTotal > 0) ? "secondary" : "primary"}
                onClick={onDone}
              >
                Back to the bill
              </Button>
            </>
          )
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 p-5 md:p-6 lg:overflow-y-auto">
        <h2 className="text-[21px] font-bold">Bill</h2>
        {unbilled.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Nothing to pay. Add snacks or hours and they appear here.
          </p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {unbilled.map((l) => (
              <li key={l.id} className="group flex items-center justify-between gap-2">
                <span className="min-w-0 py-1">
                  {l.label}
                  {l.kind === "SNACK" && l.qty > 1 && (
                    <span className="text-muted"> × {l.qty}</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="tabular-nums">
                    {money(l.qty * l.unit_price, l.currency)}
                  </span>
                  {/* Two targets: step one unit off, or drop the whole line. */}
                  {l.qty > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveLine(l.id)}
                      disabled={busy}
                      aria-label={`Remove one ${l.label}`}
                      className="grid h-11 w-11 place-items-center rounded-sm text-muted hover:bg-surface-soft hover:text-ink disabled:opacity-40"
                    >
                      <span aria-hidden>−</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveLine(l.id)}
                    disabled={busy}
                    aria-label={`Remove ${l.label}${l.qty > 1 ? `, all ${l.qty}` : ""} from the bill`}
                    className="grid h-11 w-11 place-items-center rounded-sm text-muted hover:bg-surface-soft hover:text-error disabled:opacity-40"
                  >
                    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                    </svg>
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {billed.length > 0 && (
          <details className="mt-5 text-sm">
            <summary className="min-h-11 cursor-pointer py-2 text-body">
              Already paid ({billed.length})
            </summary>
            <ul className="space-y-1 text-muted">
              {billed.map((l) => (
                <li key={l.id} className="flex justify-between gap-3">
                  <span>{l.label}</span>
                  <span className="tabular-nums">
                    {money(l.qty * l.unit_price, l.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className="space-y-3 border-t border-hairline p-5 md:p-6">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">To pay</span>
          <span className="text-[28px] font-bold tabular-nums">
            {money(converted.total, chargeCurrency)}
          </span>
        </div>
        <div role="group" aria-label="Charge in" className="flex gap-2">
          {(["KHR", "USD"] as Currency[]).map((c) => {
            const on = chargeCurrency === c;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => onChargeCurrency(c === shop ? null : c)}
                disabled={busy}
                className={`min-h-11 flex-1 rounded-sm border-2 font-medium tabular-nums ${
                  on
                    ? "border-ink bg-surface-soft text-ink"
                    : "border-hairline text-muted hover:border-field"
                }`}
              >
                {c === "KHR" ? "៛ Riel" : "$ US Dollar"}
              </button>
            );
          })}
        </div>
        <Button
          className="w-full"
          onClick={onCharge}
          disabled={busy || detail.unbilledTotal <= 0}
        >
          Charge {money(converted.total, chargeCurrency)} with KHQR
        </Button>
        <Button
          className="w-full"
          variant="secondary"
          onClick={onClose}
          disabled={busy || !canClose}
        >
          Check out and close room
        </Button>
        {!canClose && detail.unbilledTotal > 0 && (
          <p className="text-center text-sm text-muted">
            Collect payment before checking out.
          </p>
        )}
      </div>
    </div>
  );
}
