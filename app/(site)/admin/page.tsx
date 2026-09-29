"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMoney, useShopCurrency } from "@/components/currency";
import {
  Button,
  Field,
  Modal,
  Notice,
  RoomStatusLabel,
  type RoomStatus,
} from "@/components/ui";
import {
  minorToMajor,
  moneyInputAttrs,
  parseMoneyInput,
  type Currency,
} from "@/lib/money";

interface Room {
  id: string;
  code: string;
  name: string;
  hourly_rate: number;
  capacity: number;
  status: RoomStatus;
  image_url: string | null;
}
interface MenuItem {
  id: string;
  name: string;
  price: number;
  available: number;
  image_url: string | null;
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

const bookingStatus: Record<BookingH["status"], string> = {
  ACTIVE: "In room",
  CLOSED: "Checked out",
  CANCELLED: "Cancelled",
};

async function send(
  url: string,
  method: "POST" | "PATCH",
  body: object,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    return (
      (await res.json().catch(() => ({}))).error ?? "Saving failed. Try again."
    );
  } catch {
    return "No connection to the server. Try again.";
  }
}

/**
 * Photo picker for the edit dialogs. The file goes up as soon as it is chosen
 * and the returned path becomes form state, so Save sends one JSON payload.
 */
function PhotoField({
  id,
  label,
  imageUrl,
  onChange,
  shape = "square",
}: {
  id: string;
  label: string;
  imageUrl: string | null;
  onChange: (url: string | null) => void;
  shape?: "square" | "wide";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That image could not be uploaded.");
        return;
      }
      onChange(data.imageUrl ?? null);
    } catch {
      setError("No connection to the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col-span-full">
      <p className="text-sm font-medium text-muted">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-4 rounded-sm border border-hairline-soft p-3">
        <div
          className={`grid shrink-0 place-items-center overflow-hidden rounded-sm bg-surface-strong ${
            shape === "square" ? "h-20 w-20" : "h-20 w-28"
          }`}
        >
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="px-2 text-center text-xs leading-tight text-muted">
              No photo
            </span>
          )}
        </div>
        {/* self-stretch so justify-center has the tile's height to work against. */}
        <div className="flex min-w-[15rem] flex-1 self-stretch flex-col justify-center gap-2">
          <input
            ref={input}
            id={id}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) upload(file);
            }}
          />
          {/* Buttons sit in one row so the block keeps a single predictable height. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => input.current?.click()}
              disabled={busy}
            >
              {busy ? "Uploading…" : imageUrl ? "Replace photo" : "Choose photo"}
            </Button>
            {imageUrl && (
              <Button
                type="button"
                variant="tertiary"
                size="sm"
                onClick={() => onChange(null)}
                disabled={busy}
              >
                Remove photo
              </Button>
            )}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          ) : (
            <p className="text-sm text-muted">
              JPEG, PNG, WebP or GIF, up to 4 MB.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Fallback tile for items with no photo, so seeded data still reads as a card. */
function Thumb({
  url,
  alt,
  className = "h-16 w-16",
  label,
}: {
  url: string | null;
  alt: string;
  className?: string;
  label?: string;
}) {
  if (!url)
    return (
      <div
        className={`grid shrink-0 place-items-center rounded-sm bg-surface-soft text-sm font-semibold text-muted ${className}`}
      >
        {label ?? alt.slice(0, 2)}
      </div>
    );
  return (
    <img
      src={url}
      alt={alt}
      className={`shrink-0 rounded-sm object-cover ${className}`}
    />
  );
}

/** One dialog for both new and existing rooms, so a photo can be set at creation. */
function RoomDialog({
  room,
  onDone,
}: {
  room?: Room;
  onDone: (message?: string) => void;
}) {
  const currency = useShopCurrency();
  const input = moneyInputAttrs(currency);
  const [code, setCode] = useState(room?.code ?? "");
  const [name, setName] = useState(room?.name ?? "");
  const [rate, setRate] = useState(
    room ? String(minorToMajor(room.hourly_rate, currency)) : "",
  );
  const [seats, setSeats] = useState(room ? String(room.capacity) : "");
  const [imageUrl, setImageUrl] = useState<string | null>(
    room?.image_url ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prefix = room ? `room-${room.id}` : "room-new";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const hourlyRate = parseMoneyInput(rate, currency);
    if (hourlyRate === null)
      return setError(`Enter the hourly rate in ${currency}, above zero.`);
    setBusy(true);
    const body = { name, hourlyRate, capacity: Number(seats), imageUrl };
    const err = room
      ? await send(`/api/rooms/${room.id}`, "PATCH", body)
      : await send("/api/rooms", "POST", { ...body, code });
    setBusy(false);
    if (err) return setError(err);
    onDone(room ? `Saved ${room.code}.` : `Added room ${code.toUpperCase()}.`);
  }

  return (
    <form onSubmit={submit} className="grid gap-x-4 gap-y-5 sm:grid-cols-2" noValidate>
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
      <Field
        id={`${prefix}-name`}
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Field
        id={`${prefix}-rate`}
        label="Rate per hour"
        prefix={input.prefix}
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
      <PhotoField
        id={`${prefix}-photo`}
        label="Photo"
        imageUrl={imageUrl}
        onChange={setImageUrl}
        shape="wide"
      />
      {error && (
        <div className="col-span-full">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <div className="col-span-full flex flex-wrap gap-3 border-t border-hairline-soft pt-4">
        <Button type="submit" disabled={busy}>
          {room ? "Save room" : "Add room"}
        </Button>
        <Button variant="secondary" onClick={() => onDone()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function MenuDialog({
  item,
  onDone,
}: {
  item?: MenuItem;
  onDone: (message: string) => void;
}) {
  const currency = useShopCurrency();
  const input = moneyInputAttrs(currency);
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(
    item ? String(minorToMajor(item.price, currency)) : "",
  );
  const [imageUrl, setImageUrl] = useState<string | null>(
    item?.image_url ?? null,
  );
  const [available, setAvailable] = useState(
    item ? item.available === 1 : true,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prefix = item ? `menu-${item.id}` : "menu-new";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const minor = parseMoneyInput(price, currency);
    if (!name.trim()) return setError("Enter the item name.");
    if (minor === null)
      return setError(`Enter the price in ${currency}, above zero.`);
    setBusy(true);
    const err = item
      ? await send(`/api/menu/${item.id}`, "PATCH", {
          name,
          price: minor,
          available,
          imageUrl,
        })
      : await send("/api/menu", "POST", { name, price: minor });
    setBusy(false);
    if (err) return setError(err);
    onDone(
      item ? `Saved ${name.trim()}.` : `Added ${name.trim()} to the menu.`,
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-x-4 gap-y-5 sm:grid-cols-2" noValidate>
      <Field
        id={`${prefix}-name`}
        label="Item"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Field
        id={`${prefix}-price`}
        label="Price"
        prefix={input.prefix}
        type="number"
        inputMode="decimal"
        min={input.min}
        step={input.step}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        required
      />
      <PhotoField
        id={`${prefix}-photo`}
        label="Photo"
        imageUrl={imageUrl}
        onChange={setImageUrl}
      />
      {item && (
        <div className="col-span-full">
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-sm border border-hairline-soft bg-surface-soft px-4">
            <input
              type="checkbox"
              checked={available}
              onChange={(e) => setAvailable(e.target.checked)}
              className="h-5 w-5 shrink-0 rounded-sm border border-field accent-primary-fill"
            />
            <span className="text-body">Show this item to guests</span>
          </label>
        </div>
      )}
      {error && (
        <div className="col-span-full">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <div className="col-span-full flex flex-wrap gap-3 border-t border-hairline-soft pt-4">
        <Button type="submit" disabled={busy}>
          {item ? "Save item" : "Add item"}
        </Button>
        <Button variant="secondary" onClick={() => onDone("")}>
          Cancel
        </Button>
      </div>
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
  // One dialog at a time; a room id, a menu item id, or "new" for either kind.
  const [dialog, setDialog] = useState<{
    kind: "room" | "menu";
    id: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, m, i, b] = await Promise.all(
        ["/api/rooms", "/api/menu", "/api/invoices", "/api/bookings"].map((u) =>
          fetch(u).then((x) => (x.ok ? x.json() : Promise.reject())),
        ),
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
    setDialog(null);
    if (message) setNotice(message);
    load();
  };

  const paid = invoices?.filter((i) => i.status === "PAID") ?? [];

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 md:py-12 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] font-bold">Admin</h1>
        <Link
          href="/admin/khqr-test"
          className="flex min-h-11 items-center text-sm font-medium text-ink underline"
        >
          Test KHQR with a bank app
        </Link>
      </div>

      <nav
        aria-label="Admin sections"
        className="mt-6 flex gap-8 border-b border-hairline"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            aria-pressed={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setNotice(null);
            }}
            className={`-mb-px min-h-12 border-b-2 text-base font-semibold ${
              tab === t.id
                ? "border-ink text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-6 space-y-4">
        {notice && <Notice>{notice}</Notice>}
        {loadError && (
          <Notice tone="error">
            Admin data could not load. Refresh the page to try again.
          </Notice>
        )}
      </div>

      {tab === "rooms" && (
        <section aria-label="Rooms" className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Rooms</h2>
            <Button onClick={() => setDialog({ kind: "room", id: null })}>
              Add room
            </Button>
          </div>
          {!rooms && !loadError && (
            <p className="mt-3 text-muted">Loading rooms…</p>
          )}
          {rooms?.length === 0 && (
            <p className="mt-3 text-muted">No rooms yet. Add the first one.</p>
          )}
          <ul className="mt-3 divide-y divide-hairline-soft border-y border-hairline-soft">
            {rooms?.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <button
                    onClick={() => setDialog({ kind: "room", id: r.id })}
                    className="flex min-h-11 flex-1 items-center gap-4 text-left"
                  >
                    <Thumb
                      url={r.image_url}
                      alt={r.name}
                      label={r.code}
                      className="h-14 w-14"
                    />
                    <span className="w-14 shrink-0 text-2xl font-bold">
                      {r.code}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{r.name}</span>
                      <span className="block text-sm text-muted">
                        {money(r.hourly_rate)} per hour · {r.capacity} seats
                      </span>
                    </span>
                  </button>
                  <RoomStatusLabel status={r.status} className="text-body" />
                  <Link
                    href={`/admin/rooms/${r.id}/print`}
                    className="flex min-h-11 items-center text-sm font-medium underline"
                  >
                    Print door QR
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">
            Select a room to change its name, rate, seats or photo.
          </p>
        </section>
      )}

      {tab === "menu" && (
        <section aria-label="Menu" className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Menu</h2>
            <Button onClick={() => setDialog({ kind: "menu", id: null })}>
              Add item
            </Button>
          </div>
          {!menu && !loadError && (
            <p className="mt-3 text-muted">Loading menu…</p>
          )}
          {menu?.length === 0 && (
            <p className="mt-3 text-muted">
              The menu is empty. Add the first item.
            </p>
          )}
          <ul className="mt-3 max-w-2xl divide-y divide-hairline-soft border-y border-hairline-soft">
            {menu?.map((m) => (
              <li key={m.id} className="py-3">
                <button
                  onClick={() => setDialog({ kind: "menu", id: m.id })}
                  className="flex min-h-11 w-full items-center gap-4 text-left"
                >
                  <Thumb url={m.image_url} alt={m.name} />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block font-medium ${m.available === 1 ? "" : "text-muted"}`}
                    >
                      {m.name}
                    </span>
                    <span className="block text-sm text-muted tabular-nums">
                      {money(m.price)}
                      {m.available !== 1 && " · hidden from guests"}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="shrink-0 pr-1 text-xl leading-none text-muted"
                  >
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">
            Select an item to change its name, price, photo or whether guests
            see it.
          </p>
        </section>
      )}

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={
          dialog?.kind === "room"
            ? dialog.id
              ? `Edit room ${rooms?.find((r) => r.id === dialog.id)?.code ?? ""}`
              : "Add a room"
            : dialog?.id
              ? `Edit ${menu?.find((m) => m.id === dialog.id)?.name ?? "item"}`
              : "Add an item"
        }
      >
        {dialog?.kind === "room" ? (
          <RoomDialog
            key={dialog.id ?? "new-room"}
            room={rooms?.find((r) => r.id === dialog.id)}
            onDone={done}
          />
        ) : dialog?.kind === "menu" ? (
          <MenuDialog
            key={dialog.id ?? "new-menu"}
            item={menu?.find((m) => m.id === dialog.id)}
            onDone={done}
          />
        ) : null}
      </Modal>

      {tab === "history" && (
        <section
          aria-label="History"
          className="mt-6 grid gap-12 lg:grid-cols-2"
        >
          <div>
            <h2 className="text-xl font-semibold">Payments received</h2>
            {!invoices && !loadError && (
              <p className="mt-3 text-muted">Loading payments…</p>
            )}
            {invoices && paid.length === 0 && (
              <p className="mt-3 text-muted">
                No payments yet. They appear here once a KHQR is paid.
              </p>
            )}
            <ul className="mt-3 divide-y divide-hairline-soft">
              {paid.map((i) => (
                <li
                  key={i.id}
                  className="flex items-start justify-between gap-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      Room {i.room_code} · ref {i.md5.slice(0, 8).toUpperCase()}
                    </p>
                    <p className="text-muted">
                      {new Date(i.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">
                    {money(i.total, i.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-xl font-semibold">Bookings</h2>
            {!bookings && !loadError && (
              <p className="mt-3 text-muted">Loading bookings…</p>
            )}
            {bookings?.length === 0 && (
              <p className="mt-3 text-muted">
                No bookings yet. Check a guest in from the Staff POS.
              </p>
            )}
            <ul className="mt-3 divide-y divide-hairline-soft">
              {bookings?.map((b) => (
                <li
                  key={b.id}
                  className="flex items-start justify-between gap-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      Room {b.room_code} · {b.customer_name}
                    </p>
                    <p className="text-muted">
                      {new Date(b.created_at).toLocaleString()}
                    </p>
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
