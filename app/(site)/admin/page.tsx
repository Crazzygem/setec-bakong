"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useMoney, useShopCurrency } from "@/components/currency";
import { Button, Field, Notice, RoomStatusLabel, type RoomStatus } from "@/components/ui";
import { minorToMajor, moneyInputAttrs, parseMoneyInput, type Currency } from "@/lib/money";

interface Room {
  id: string;
  code: string;
  name: string;
  hourly_rate: number;
  capacity: number;
  status: RoomStatus;
}
interface MenuItem {
  id: string;
  name: string;
  price: number;
  available: number;
}
interface Invoice {
  id: string;
  total: number;
  currency: Currency;
  status: "PENDING" | "PAID" | "EXPIRED";
  md5: string;
  created_at: number;
  room_code: string;
}
interface BookingH {
  id: string;
  customer_name: string;
  status: "ACTIVE" | "CLOSED" | "CANCELLED";
  created_at: number;
  room_code: string;
}

type Tab = "rooms" | "menu" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "rooms", label: "Rooms" },
  { id: "menu", label: "Menu" },
  { id: "history", label: "History" },
];

const bookingStatus: Record<BookingH["status"], string> = { ACTIVE: "In room", CLOSED: "Checked out", CANCELLED: "Cancelled" };

async function send(url: string, method: "POST" | "PATCH", body: object): Promise<string | null> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    return (await res.json().catch(() => ({}))).error ?? "Saving failed. Try again.";
  } catch {
    return "No connection to the server. Try again.";
  }
}

function RoomForm({ room, onDone }: { room?: Room; onDone: (message?: string) => void }) {
  const currency = useShopCurrency();
  const input = moneyInputAttrs(currency);
  const [code, setCode] = useState(room?.code ?? "");
  const [name, setName] = useState(room?.name ?? "");
  const [rate, setRate] = useState(room ? String(minorToMajor(room.hourly_rate, currency)) : "");
  const [seats, setSeats] = useState(room ? String(room.capacity) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prefix = room ? `room-${room.id}` : "room-new";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const hourlyRate = parseMoneyInput(rate, currency);
    if (hourlyRate === null) return setError(`Enter the hourly rate in ${currency}, above zero.`);
    setBusy(true);
    const body = { name, hourlyRate, capacity: Number(seats) };
    const err = room
      ? await send(`/api/rooms/${room.id}`, "PATCH", body)
      : await send("/api/rooms", "POST", { ...body, code });
    setBusy(false);
    if (err) return setError(err);
    onDone(room ? `Saved ${room.code}.` : `Added room ${code.toUpperCase()}.`);
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" noValidate>
      {!room && (
        <Field
          id={`${prefix}-code`}
          label="Room code"
          hint="Printed on the door. Cannot change later."
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={8}
          required
        />
      )}
      <Field id={`${prefix}-name`} label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Field
        id={`${prefix}-rate`}
        label={`Rate per hour (${currency})`}
        inputMode="decimal"
        type="number"
        min={input.min}
        step={input.step}
        value={rate}
        onChange={(e) => setRate(e.target.value)}
        required
      />
      <Field
        id={`${prefix}-seats`}
        label="Seats"
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        value={seats}
        onChange={(e) => setSeats(e.target.value)}
        required
      />
      {error && (
        <div className="md:col-span-2 lg:col-span-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <div className="flex flex-wrap gap-3 md:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={busy}>
          {room ? "Save room" : "Add room"}
        </Button>
        {room && (
          <Button variant="secondary" onClick={() => onDone()}>
            Discard changes
          </Button>
        )}
      </div>
    </form>
  );
}

function MenuForm({ onDone }: { onDone: (message: string) => void }) {
  const currency = useShopCurrency();
  const input = moneyInputAttrs(currency);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const minor = parseMoneyInput(price, currency);
    if (!name.trim()) return setError("Enter the item name.");
    if (minor === null) return setError(`Enter the price in ${currency}, above zero.`);
    const err = await send("/api/menu", "POST", { name, price: minor });
    if (err) return setError(err);
    setName("");
    setPrice("");
    setError(null);
    onDone(`Added ${name.trim()} to the menu.`);
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-[2fr_1fr_auto] md:items-end" noValidate>
      <Field id="menu-name" label="Item" value={name} onChange={(e) => setName(e.target.value)} />
      <Field
        id="menu-price"
        label={`Price (${currency})`}
        type="number"
        inputMode="decimal"
        min={input.min}
        step={input.step}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <Button type="submit" className="h-14">
        Add item
      </Button>
      {error && (
        <div className="md:col-span-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </form>
  );
}

export default function AdminPage() {
  const money = useMoney();
  const [tab, setTab] = useState<Tab>("rooms");
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [bookings, setBookings] = useState<BookingH[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, m, i, b] = await Promise.all(
        ["/api/rooms", "/api/menu", "/api/invoices", "/api/bookings"].map((u) =>
          fetch(u).then((x) => (x.ok ? x.json() : Promise.reject()))
        )
      );
      setRooms(r.rooms);
      setMenu(m.items);
      setInvoices(i.invoices);
      setBookings(b.bookings);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const done = (message?: string) => {
    setEditing(null);
    if (message) setNotice(message);
    load();
  };

  async function toggleItem(m: MenuItem) {
    const err = await send(`/api/menu/${m.id}`, "PATCH", { available: m.available !== 1 });
    setNotice(err ?? `${m.name} is now ${m.available === 1 ? "hidden from guests" : "on the menu"}.`);
    load();
  }

  const paid = invoices?.filter((i) => i.status === "PAID") ?? [];

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 md:py-12 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] font-bold">Admin</h1>
        <Link href="/admin/khqr-test" className="flex min-h-11 items-center text-sm font-medium text-ink underline">
          Test KHQR with a bank app
        </Link>
      </div>

      <nav aria-label="Admin sections" className="mt-6 flex gap-8 border-b border-hairline">
        {TABS.map((t) => (
          <button
            key={t.id}
            aria-pressed={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setNotice(null);
            }}
            className={`-mb-px min-h-12 border-b-2 text-base font-semibold ${
              tab === t.id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-6 space-y-4">
        {notice && <Notice>{notice}</Notice>}
        {loadError && <Notice tone="error">Admin data could not load. Refresh the page to try again.</Notice>}
      </div>

      {tab === "rooms" && (
        <section aria-label="Rooms" className="mt-6">
          <h2 className="text-xl font-semibold">Add a room</h2>
          <div className="mt-4">
            <RoomForm key={rooms?.length ?? 0} onDone={done} />
          </div>
          <h2 className="mt-12 text-xl font-semibold">Rooms</h2>
          {!rooms && !loadError && <p className="mt-3 text-muted">Loading rooms…</p>}
          {rooms?.length === 0 && <p className="mt-3 text-muted">No rooms yet. Add the first one above.</p>}
          <ul className="mt-3 divide-y divide-hairline-soft border-y border-hairline-soft">
            {rooms?.map((r) => (
              <li key={r.id} className="py-4">
                {editing === r.id ? (
                  <div>
                    <p className="mb-3 font-semibold">Editing {r.code}</p>
                    <RoomForm room={r} onDone={done} />
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <span className="w-14 text-2xl font-bold">{r.code}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-sm text-muted">
                        {money(r.hourly_rate)} per hour · {r.capacity} seats
                      </p>
                    </div>
                    <RoomStatusLabel status={r.status} className="text-body" />
                    <div className="flex gap-4">
                      <Button variant="tertiary" size="sm" onClick={() => setEditing(r.id)}>
                        Edit
                      </Button>
                      <Link href={`/admin/rooms/${r.id}/print`} className="flex min-h-11 items-center text-sm font-medium underline">
                        Print door QR
                      </Link>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "menu" && (
        <section aria-label="Menu" className="mt-6">
          <h2 className="text-xl font-semibold">Add an item</h2>
          <div className="mt-4 max-w-2xl">
            <MenuForm onDone={done} />
          </div>
          <h2 className="mt-12 text-xl font-semibold">Menu</h2>
          {!menu && !loadError && <p className="mt-3 text-muted">Loading menu…</p>}
          {menu?.length === 0 && <p className="mt-3 text-muted">The menu is empty. Add the first item above.</p>}
          <ul className="mt-3 max-w-2xl divide-y divide-hairline-soft border-y border-hairline-soft">
            {menu?.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                <div>
                  <p className={m.available === 1 ? "font-medium" : "font-medium text-muted"}>{m.name}</p>
                  <p className="text-sm text-muted">
                    {money(m.price)}
                    {m.available !== 1 && " · hidden from guests"}
                  </p>
                </div>
                <Button variant="tertiary" size="sm" onClick={() => toggleItem(m)}>
                  {m.available === 1 ? "Hide from guests" : "Show to guests"}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "history" && (
        <section aria-label="History" className="mt-6 grid gap-12 lg:grid-cols-2">
          <div>
            <h2 className="text-xl font-semibold">Payments received</h2>
            {!invoices && !loadError && <p className="mt-3 text-muted">Loading payments…</p>}
            {invoices && paid.length === 0 && <p className="mt-3 text-muted">No payments yet. They appear here once a KHQR is paid.</p>}
            <ul className="mt-3 divide-y divide-hairline-soft">
              {paid.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      Room {i.room_code} · ref {i.md5.slice(0, 8).toUpperCase()}
                    </p>
                    <p className="text-muted">{new Date(i.created_at).toLocaleString()}</p>
                  </div>
                  <span className="font-semibold tabular-nums">{money(i.total, i.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-xl font-semibold">Bookings</h2>
            {!bookings && !loadError && <p className="mt-3 text-muted">Loading bookings…</p>}
            {bookings?.length === 0 && <p className="mt-3 text-muted">No bookings yet. Check a guest in from the Staff POS.</p>}
            <ul className="mt-3 divide-y divide-hairline-soft">
              {bookings?.map((b) => (
                <li key={b.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      Room {b.room_code} · {b.customer_name}
                    </p>
                    <p className="text-muted">{new Date(b.created_at).toLocaleString()}</p>
                  </div>
                  <span className="text-body">{bookingStatus[b.status]}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
