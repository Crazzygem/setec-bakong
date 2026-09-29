"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMoney } from "@/components/currency";
import { KhqrPayment } from "@/components/khqr-payment";
import { Button, Notice, RoomStatusLabel, type RoomStatus } from "@/components/ui";
import type { Currency } from "@/lib/money";

interface Room {
  id: string;
  code: string;
  name: string;
  hourly_rate: number;
  capacity: number;
  status: RoomStatus;
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
}
interface RoomState {
  room: Room;
  booking: Booking | null;
  tab: TabLine[];
  unbilledTotal: number;
  menu: MenuItem[];
  pendingInvoiceId: string | null;
}

function timeLeft(endsAt: number, now: number): string {
  const m = Math.max(0, Math.round((endsAt - now) / 60_000));
  if (m === 0) return "Your time is up";
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m} min left`;
}

function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const btn =
    "grid h-11 w-11 place-items-center rounded-full border border-field bg-canvas text-lg text-ink hover:border-ink disabled:border-hairline disabled:text-field";
  return (
    <div className="flex items-center gap-2" role="group" aria-label={`Quantity of ${label}`}>
      <button type="button" className={btn} onClick={() => onChange(value - 1)} disabled={value <= 1} aria-label={`One less ${label}`}>
        −
      </button>
      <span className="w-6 text-center tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= 10} aria-label={`One more ${label}`}>
        +
      </button>
    </div>
  );
}

export default function RoomClient({ code }: { code: string }) {
  const money = useMoney();
  const [state, setState] = useState<RoomState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [paidNote, setPaidNote] = useState(false);
  const billRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/by-code/${encodeURIComponent(code)}`);
      if (!res.ok) throw new Error();
      const data: RoomState = await res.json();
      setState(data);
      setLoadError(null);
      if (data.pendingInvoiceId) setInvoiceId((cur) => cur ?? data.pendingInvoiceId);
    } catch {
      setLoadError("Your room could not load. Check your connection and refresh.");
    }
  }, [code]);

  useEffect(() => {
    load();
    // Staff can add to the bill from the counter, so keep it fresh.
    const poll = setInterval(load, 6000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  async function post(key: string, url: string, body?: object): Promise<Record<string, unknown> | null> {
    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
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
      setBusy(null);
    }
  }

  async function addSnack(item: MenuItem) {
    if (!state?.booking) return;
    const ok = await post(item.id, `/api/bookings/${state.booking.id}/items`, {
      kind: "SNACK",
      menuItemId: item.id,
      qty: qty[item.id] ?? 1,
    });
    if (ok) setQty((q) => ({ ...q, [item.id]: 1 }));
    await load();
  }

  async function extend(hours: number) {
    if (!state?.booking) return;
    await post(`ext${hours}`, `/api/bookings/${state.booking.id}/items`, { kind: "ROOM_HOURS", hours });
    await load();
  }

  async function pay() {
    if (!state?.booking) return;
    setPaidNote(false);
    const data = await post("pay", `/api/bookings/${state.booking.id}/invoices`);
    const inv = data?.invoice as { id: string } | undefined;
    if (inv) {
      setInvoiceId(inv.id);
      billRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const onSettled = useCallback(
    (status: "PAID" | "EXPIRED") => {
      setInvoiceId(null);
      setPaidNote(status === "PAID");
      load();
    },
    [load]
  );

  if (loadError && !state)
    return (
      <div className="mx-auto max-w-[1080px] px-4 py-16 sm:px-6">
        <Notice tone="error">{loadError}</Notice>
      </div>
    );
  if (!state) return <p className="mx-auto max-w-[1080px] px-4 py-16 text-muted sm:px-6">Loading room {code}…</p>;

  const { room, booking, tab, unbilledTotal, menu } = state;
  const unbilled = tab.filter((l) => l.state === "UNBILLED");
  const paid = tab.filter((l) => l.state === "BILLED");
  const qrOpen = invoiceId !== null;

  const header = (
    <div className="flex items-end justify-between gap-4 border-b border-hairline-soft pb-6">
      <div>
        <p className="text-sm text-muted">{room.name}</p>
        <h1 className="mt-1 text-[22px] leading-tight font-medium">
          {booking ? `Welcome, ${booking.customer_name}` : "This room is free right now"}
        </h1>
        <p className="mt-2 text-sm text-body">
          {booking ? timeLeft(booking.ends_at, now) : `${money(room.hourly_rate)} per hour, ${room.capacity} seats`}
        </p>
      </div>
      <span className="text-[64px] leading-none font-bold tracking-tight" aria-label={`Room ${room.code}`}>
        {room.code}
      </span>
    </div>
  );

  if (!booking)
    return (
      <div className="mx-auto max-w-[1080px] px-4 py-8 sm:px-6 md:py-12">
        {header}
        <div className="mt-6 max-w-xl">
          <RoomStatusLabel status={room.status} />
          <p className="mt-2 text-body">Ask at the counter to check in. Once your time starts, this page shows your bill.</p>
          <h2 className="mt-10 text-xl font-semibold">On the menu</h2>
          {menu.length === 0 ? (
            <p className="mt-2 text-sm text-muted">The menu is empty right now.</p>
          ) : (
            <ul className="mt-2 divide-y divide-hairline-soft">
              {menu.map((m) => (
                <li key={m.id} className="flex justify-between py-3">
                  <span>{m.name}</span>
                  <span className="tabular-nums">{money(m.price)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );

  return (
    <div className="mx-auto max-w-[1080px] px-4 pt-8 pb-28 sm:px-6 md:pt-12 lg:pb-16">
      {header}
      {msg && (
        <div className="mt-6">
          <Notice tone="error">{msg}</Notice>
        </div>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16">
        <div>
          <h2 className="text-xl font-semibold">Snacks and drinks</h2>
          <p className="mt-1 text-sm text-muted">Delivered to your room. Added items go on your bill.</p>
          {menu.length === 0 ? (
            <p className="mt-4 text-sm text-muted">Nothing on the menu right now.</p>
          ) : (
            <ul className="mt-4 divide-y divide-hairline-soft border-y border-hairline-soft">
              {menu.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{m.name}</p>
                    <p className="text-sm text-muted tabular-nums">{money(m.price)}</p>
                  </div>
                  <Stepper label={m.name} value={qty[m.id] ?? 1} onChange={(n) => setQty((q) => ({ ...q, [m.id]: n }))} />
                  <Button variant="secondary" size="sm" onClick={() => addSnack(m)} disabled={busy !== null}>
                    {busy === m.id ? "Adding…" : "Add"}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-10 text-xl font-semibold">Stay longer</h2>
          <p className="mt-1 text-sm text-muted">Extra time starts after your current end time, once it is paid.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {[1, 2].map((h) => (
              <Button key={h} variant="secondary" onClick={() => extend(h)} disabled={busy !== null}>
                Add {h} hour{h > 1 ? "s" : ""} · {money(h * room.hourly_rate)}
              </Button>
            ))}
          </div>
        </div>

        <div ref={billRef} id="bill" className="scroll-mt-6">
          <div className="rounded-md border border-hairline bg-canvas p-6 shadow-float lg:sticky lg:top-6">
            {qrOpen ? (
              <>
                <h2 className="mb-4 text-center text-base font-semibold">Pay with KHQR</h2>
                <KhqrPayment key={invoiceId} invoiceId={invoiceId!} onSettled={onSettled} showSave />
              </>
            ) : (
              <>
                <h2 className="text-[21px] font-bold">Your bill</h2>
                {paidNote && (
                  <div className="mt-3">
                    <Notice>Payment received. Thank you.</Notice>
                  </div>
                )}
                {unbilled.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">Nothing to pay right now.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {unbilled.map((l) => (
                      <li key={l.id} className="flex justify-between gap-3">
                        <span>
                          {l.label}
                          {l.kind === "SNACK" && l.qty > 1 && <span className="text-muted"> × {l.qty}</span>}
                        </span>
                        <span className="tabular-nums">{money(l.qty * l.unit_price, l.currency)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 flex items-baseline justify-between border-t border-hairline pt-4">
                  <span className="font-semibold">To pay</span>
                  <span className="text-[21px] font-bold tabular-nums">{money(unbilledTotal)}</span>
                </div>
                <Button className="mt-4 w-full" onClick={pay} disabled={busy !== null || unbilledTotal <= 0}>
                  {busy === "pay" ? "Making your QR…" : `Pay ${money(unbilledTotal)} with KHQR`}
                </Button>
                {paid.length > 0 && (
                  <details className="mt-5 text-sm">
                    <summary className="min-h-11 cursor-pointer py-2 text-body">Already paid ({paid.length})</summary>
                    <ul className="space-y-1 text-muted">
                      {paid.map((l) => (
                        <li key={l.id} className="flex justify-between gap-3">
                          <span>{l.label}</span>
                          <span className="tabular-nums">{money(l.qty * l.unit_price, l.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Phones: the bill sits below the menu, so this bar keeps the total and the pay action in reach. */}
      {!qrOpen && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-hairline bg-canvas px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:hidden">
          <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted">To pay</p>
              <p className="text-lg font-bold tabular-nums">{money(unbilledTotal)}</p>
            </div>
            <Button onClick={pay} disabled={busy !== null || unbilledTotal <= 0}>
              {busy === "pay" ? "Making QR…" : "Pay with KHQR"}
            </Button>
          </div>
        </div>
      )}
      <p className="mt-10 text-sm text-muted">
        Wrong room?{" "}
        <Link href="/" className="font-medium text-ink underline">
          Enter a different code
        </Link>
      </p>
    </div>
  );
}
