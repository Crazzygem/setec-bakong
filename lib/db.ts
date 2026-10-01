import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { convertMinor, isCurrency, type Currency } from "@/lib/money";
import { shopCurrency } from "@/lib/shop";

export type RoomStatus = "AVAILABLE" | "OCCUPIED" | "CLEANING";
export type BookingStatus = "ACTIVE" | "CLOSED" | "CANCELLED";
export type TabState = "UNBILLED" | "BILLED" | "VOID";
export type TabKind = "ROOM_HOURS" | "SNACK";
export type InvoiceStatus = "PENDING" | "PAID" | "EXPIRED";

// Money columns hold minor units (cents or riel). Rooms and menu prices are in
// the shop currency; tab lines and invoices carry their own currency so history
// stays correct after SHOP_CURRENCY changes.

export interface RoomRow {
  id: string;
  code: string;
  name: string;
  hourly_rate: number;
  capacity: number;
  status: RoomStatus;
  image_url: string | null;
}

export interface MenuItemRow {
  id: string;
  name: string;
  price: number;
  available: number;
  image_url: string | null;
}

export interface BookingRow {
  id: string;
  room_id: string;
  customer_name: string;
  ends_at: number;
  status: BookingStatus;
  created_at: number;
}

export interface TabItemRow {
  id: string;
  booking_id: string;
  kind: TabKind;
  menu_item_id: string | null;
  label: string;
  qty: number;
  unit_price: number;
  currency: Currency;
  state: TabState;
  created_at: number;
}

export interface InvoiceRow {
  id: string;
  booking_id: string;
  total: number;
  currency: Currency;
  qr: string;
  md5: string;
  status: InvoiceStatus;
  lines_json: string;
  expires_at: number;
  created_at: number;
}

export interface BookingLines {
  tabItemIds: string[];
  extendHours: number;
}

type HttpError = Error & { status: number };
const fail = (message: string, status: number): HttpError => Object.assign(new Error(message), { status });

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const path = process.env.DATABASE_PATH ?? "./data/app.db";
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initDb(db);
  return db;
}

const SCHEMA_VERSION = 2;

function columns(d: Database.Database, table: string): string[] {
  return (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function initDb(d: Database.Database): void {
  const version = d.pragma("user_version", { simple: true }) as number;
  if (version < SCHEMA_VERSION) {
    const legacy = columns(d, "rooms").includes("hourly_rate_khr");
    d.transaction(() => (legacy ? migrateFromKhrOnly(d) : createSchema(d)))();
    if (version >= 1) addPhotoColumns(d);
    d.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
  seed(d);
  syncPriceCurrency(d);
}

/** Photos arrived after the first release, so existing installs get the columns in place. */
function addPhotoColumns(d: Database.Database): void {
  for (const table of ["rooms", "menu_items"])
    if (!columns(d, table).includes("image_url")) d.exec(`ALTER TABLE ${table} ADD COLUMN image_url TEXT`);
}

function createSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rooms(
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      hourly_rate INTEGER NOT NULL,
      capacity INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      image_url TEXT
    );
    CREATE TABLE IF NOT EXISTS menu_items(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      available INTEGER NOT NULL DEFAULT 1,
      image_url TEXT
    );
    CREATE TABLE IF NOT EXISTS bookings(
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id),
      customer_name TEXT NOT NULL,
      ends_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tab_items(
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id),
      kind TEXT NOT NULL,
      menu_item_id TEXT,
      label TEXT NOT NULL,
      qty INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      currency TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'UNBILLED',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoices(
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id),
      total INTEGER NOT NULL,
      currency TEXT NOT NULL,
      qr TEXT NOT NULL,
      md5 TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'PENDING',
      lines_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_room ON bookings(room_id);
    CREATE INDEX IF NOT EXISTS idx_tab_booking ON tab_items(booking_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);
  `);
  d.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES('price_currency', ?)").run(shopCurrency());
}

/** The first schema priced everything in riel with *_khr columns; keep its history. */
function migrateFromKhrOnly(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    ALTER TABLE rooms RENAME COLUMN hourly_rate_khr TO hourly_rate;
    ALTER TABLE rooms DROP COLUMN emoji;
    ALTER TABLE menu_items RENAME COLUMN price_khr TO price;
    ALTER TABLE menu_items DROP COLUMN emoji;
    ALTER TABLE tab_items RENAME COLUMN unit_price_khr TO unit_price;
    ALTER TABLE tab_items ADD COLUMN currency TEXT NOT NULL DEFAULT 'KHR';
    ALTER TABLE invoices RENAME COLUMN total_khr TO total;
    ALTER TABLE invoices ADD COLUMN currency TEXT NOT NULL DEFAULT 'KHR';
    INSERT OR REPLACE INTO meta(key, value) VALUES('price_currency', 'KHR');
  `);
}

/** Small runtime switches kept in the meta table, so the admin page can change them without a restart. */
export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)").run(key, value);
}

/** Re-prices rooms, menu and not-yet-billed lines when SHOP_CURRENCY changes. */
function syncPriceCurrency(d: Database.Database): void {
  const row = d.prepare("SELECT value FROM meta WHERE key = 'price_currency'").get() as { value: string } | undefined;
  const from = isCurrency(row?.value) ? row.value : "KHR";
  const to = shopCurrency();
  if (from === to) return;
  d.transaction(() => {
    for (const r of d.prepare("SELECT id, hourly_rate FROM rooms").all() as { id: string; hourly_rate: number }[])
      d.prepare("UPDATE rooms SET hourly_rate = ? WHERE id = ?").run(convertMinor(r.hourly_rate, from, to), r.id);
    for (const m of d.prepare("SELECT id, price FROM menu_items").all() as { id: string; price: number }[])
      d.prepare("UPDATE menu_items SET price = ? WHERE id = ?").run(convertMinor(m.price, from, to), m.id);
    const open = d
      .prepare("SELECT id, unit_price FROM tab_items WHERE state = 'UNBILLED' AND currency = ?")
      .all(from) as { id: string; unit_price: number }[];
    for (const t of open)
      d.prepare("UPDATE tab_items SET unit_price = ?, currency = ? WHERE id = ?").run(convertMinor(t.unit_price, from, to), to, t.id);
    d.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('price_currency', ?)").run(to);
  })();
}

function seed(d: Database.Database): void {
  const usd = shopCurrency() === "USD";
  // Test pricing kept tiny so live Bakong payments cost almost nothing. Edit in Admin before real use.
  const roomCount = (d.prepare("SELECT COUNT(*) AS c FROM rooms").get() as { c: number }).c;
  if (roomCount === 0) {
    const rooms = [
      { code: "A1", name: "Small Room A1", rate: usd ? 10 : 300, capacity: 4 },
      { code: "A2", name: "Small Room A2", rate: usd ? 10 : 300, capacity: 4 },
      { code: "B1", name: "Medium Room B1", rate: usd ? 15 : 500, capacity: 6 },
      { code: "B2", name: "Medium Room B2", rate: usd ? 15 : 500, capacity: 6 },
      { code: "VIP", name: "VIP Room", rate: usd ? 25 : 800, capacity: 10 },
    ];
    const stmt = d.prepare("INSERT INTO rooms(id, code, name, hourly_rate, capacity, status) VALUES(?,?,?,?,?, 'AVAILABLE')");
    d.transaction(() => rooms.forEach((r) => stmt.run(randomUUID(), r.code, r.name, r.rate, r.capacity)))();
  }
  const menuCount = (d.prepare("SELECT COUNT(*) AS c FROM menu_items").get() as { c: number }).c;
  if (menuCount === 0) {
    const items = [
      { name: "Coke", price: usd ? 2 : 100 },
      { name: "Sprite", price: usd ? 2 : 100 },
      { name: "Water", price: usd ? 1 : 100 },
      { name: "Popcorn", price: usd ? 5 : 300 },
      { name: "Fries", price: usd ? 4 : 200 },
      { name: "Nachos", price: usd ? 6 : 400 },
    ];
    const stmt = d.prepare("INSERT INTO menu_items(id, name, price, available) VALUES(?,?,?,1)");
    d.transaction(() => items.forEach((m) => stmt.run(randomUUID(), m.name, m.price)))();
  }
}

// Rooms

export function listRooms(): RoomRow[] {
  return getDb().prepare("SELECT * FROM rooms ORDER BY code").all() as RoomRow[];
}

export function getRoomById(id: string): RoomRow | undefined {
  return getDb().prepare("SELECT * FROM rooms WHERE id = ?").get(id) as RoomRow | undefined;
}

export function getRoomByCode(code: string): RoomRow | undefined {
  return getDb().prepare("SELECT * FROM rooms WHERE code = ?").get(code.toUpperCase()) as RoomRow | undefined;
}

export function createRoom(input: { code: string; name: string; hourlyRate: number; capacity: number; imageUrl?: string | null }): RoomRow {
  const row: RoomRow = {
    id: randomUUID(),
    code: input.code.toUpperCase().trim(),
    name: input.name.trim(),
    hourly_rate: Math.round(input.hourlyRate),
    capacity: Math.round(input.capacity),
    status: "AVAILABLE",
    image_url: input.imageUrl ?? null,
  };
  getDb()
    .prepare("INSERT INTO rooms(id, code, name, hourly_rate, capacity, status, image_url) VALUES(?,?,?,?,?,?,?)")
    .run(row.id, row.code, row.name, row.hourly_rate, row.capacity, row.status, row.image_url);
  return row;
}

export function updateRoom(id: string, patch: { name?: string; hourlyRate?: number; capacity?: number; imageUrl?: string | null }): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name.trim());
  }
  if (patch.hourlyRate !== undefined) {
    sets.push("hourly_rate = ?");
    vals.push(Math.round(patch.hourlyRate));
  }
  if (patch.capacity !== undefined) {
    sets.push("capacity = ?");
    vals.push(Math.round(patch.capacity));
  }
  if (patch.imageUrl !== undefined) {
    sets.push("image_url = ?");
    vals.push(patch.imageUrl);
  }
  if (sets.length === 0) return;
  getDb().prepare(`UPDATE rooms SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function setRoomStatus(id: string, status: RoomStatus): void {
  getDb().prepare("UPDATE rooms SET status = ? WHERE id = ?").run(status, id);
}

// Menu

export function listMenu(includeUnavailable = true): MenuItemRow[] {
  const sql = includeUnavailable
    ? "SELECT * FROM menu_items ORDER BY name"
    : "SELECT * FROM menu_items WHERE available = 1 ORDER BY name";
  return getDb().prepare(sql).all() as MenuItemRow[];
}

export function getMenuItem(id: string): MenuItemRow | undefined {
  return getDb().prepare("SELECT * FROM menu_items WHERE id = ?").get(id) as MenuItemRow | undefined;
}

export function createMenuItem(input: { name: string; price: number; imageUrl?: string | null }): MenuItemRow {
  const row: MenuItemRow = {
    id: randomUUID(),
    name: input.name.trim(),
    price: Math.round(input.price),
    available: 1,
    image_url: input.imageUrl ?? null,
  };
  getDb()
    .prepare("INSERT INTO menu_items(id, name, price, available, image_url) VALUES(?,?,?,?,?)")
    .run(row.id, row.name, row.price, row.available, row.image_url);
  return row;
}

export function updateMenuItem(id: string, patch: { name?: string; price?: number; available?: boolean; imageUrl?: string | null }): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name.trim());
  }
  if (patch.price !== undefined) {
    sets.push("price = ?");
    vals.push(Math.round(patch.price));
  }
  if (patch.available !== undefined) {
    sets.push("available = ?");
    vals.push(patch.available ? 1 : 0);
  }
  if (patch.imageUrl !== undefined) {
    sets.push("image_url = ?");
    vals.push(patch.imageUrl);
  }
  if (sets.length === 0) return;
  getDb().prepare(`UPDATE menu_items SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

// Bookings and the running tab

export function getBooking(id: string): BookingRow | undefined {
  return getDb().prepare("SELECT * FROM bookings WHERE id = ?").get(id) as BookingRow | undefined;
}

export function getActiveBookingForRoom(roomId: string): BookingRow | undefined {
  return getDb()
    .prepare("SELECT * FROM bookings WHERE room_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1")
    .get(roomId) as BookingRow | undefined;
}

export function listBookings(limit = 50): (BookingRow & { room_code: string; room_name: string })[] {
  return getDb()
    .prepare(
      `SELECT b.*, r.code AS room_code, r.name AS room_name FROM bookings b
       JOIN rooms r ON r.id = b.room_id ORDER BY b.created_at DESC LIMIT ?`
    )
    .all(limit) as (BookingRow & { room_code: string; room_name: string })[];
}

function insertTabItem(d: Database.Database, row: TabItemRow): void {
  d.prepare(
    `INSERT INTO tab_items(id, booking_id, kind, menu_item_id, label, qty, unit_price, currency, state, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`
  ).run(row.id, row.booking_id, row.kind, row.menu_item_id, row.label, row.qty, row.unit_price, row.currency, row.state, row.created_at);
}

export function createBooking(input: { roomId: string; customerName: string; hours: number }): BookingRow {
  const d = getDb();
  return d.transaction((): BookingRow => {
    const room = getRoomById(input.roomId);
    if (!room) throw fail("room not found", 404);
    if (room.status !== "AVAILABLE") throw fail("room not available", 409);
    const now = Date.now();
    const hours = Math.round(input.hours);
    const booking: BookingRow = {
      id: randomUUID(),
      room_id: room.id,
      customer_name: input.customerName.trim() || "Walk-in",
      ends_at: now + hours * 3600_000,
      status: "ACTIVE",
      created_at: now,
    };
    d.prepare("INSERT INTO bookings(id, room_id, customer_name, ends_at, status, created_at) VALUES(?,?,?,?,?,?)").run(
      booking.id,
      booking.room_id,
      booking.customer_name,
      booking.ends_at,
      booking.status,
      booking.created_at
    );
    insertTabItem(d, {
      id: randomUUID(),
      booking_id: booking.id,
      kind: "ROOM_HOURS",
      menu_item_id: null,
      label: `Room ${room.code}, ${hours}h`,
      qty: hours,
      unit_price: room.hourly_rate,
      currency: shopCurrency(),
      state: "UNBILLED",
      created_at: now,
    });
    d.prepare("UPDATE rooms SET status = 'OCCUPIED' WHERE id = ?").run(room.id);
    return booking;
  })();
}

export function listTabItems(bookingId: string): TabItemRow[] {
  return getDb().prepare("SELECT * FROM tab_items WHERE booking_id = ? ORDER BY created_at").all(bookingId) as TabItemRow[];
}

export function unbilledLines(bookingId: string): TabItemRow[] {
  return getDb()
    .prepare("SELECT * FROM tab_items WHERE booking_id = ? AND state = 'UNBILLED' ORDER BY created_at")
    .all(bookingId) as TabItemRow[];
}

export function unbilledTotal(bookingId: string): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(qty * unit_price), 0) AS t FROM tab_items WHERE booking_id = ? AND state = 'UNBILLED'")
    .get(bookingId) as { t: number };
  return row.t;
}

/** Earliest ROOM_HOURS line is the check-in grant, whose time is already inside ends_at. */
export function initialRoomLineId(bookingId: string): string | null {
  const found = getDb()
    .prepare("SELECT id FROM tab_items WHERE booking_id = ? AND kind = 'ROOM_HOURS' ORDER BY created_at LIMIT 1")
    .get(bookingId) as { id: string } | undefined;
  return found?.id ?? null;
}

function activeBooking(d: Database.Database, bookingId: string): BookingRow {
  const booking = d.prepare("SELECT * FROM bookings WHERE id = ?").get(bookingId) as BookingRow | undefined;
  if (!booking) throw fail("booking not found", 404);
  if (booking.status !== "ACTIVE") throw fail("booking closed", 409);
  return booking;
}

export function addSnackItem(bookingId: string, menuItemId: string, qty: number): TabItemRow {
  const d = getDb();
  activeBooking(d, bookingId);
  const item = getMenuItem(menuItemId);
  if (!item || item.available !== 1) throw fail("item unavailable", 404);
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw fail("bad qty", 400);
  const row: TabItemRow = {
    id: randomUUID(),
    booking_id: bookingId,
    kind: "SNACK",
    menu_item_id: item.id,
    label: item.name,
    qty,
    unit_price: item.price,
    currency: shopCurrency(),
    state: "UNBILLED",
    created_at: Date.now(),
  };
  insertTabItem(d, row);
  return row;
}

/**
 * Staff correcting a mistake at the counter: takes one unit off a line, and voids
 * the line once the last unit goes. Voids rather than deletes so a paid-then-
 * disputed line still has a record. Refuses while a QR is open, because that code
 * already carries the old total, and refuses anything not yet unpaid.
 */
export function removeTabItem(bookingId: string, itemId: string): TabItemRow {
  const d = getDb();
  return d.transaction((): TabItemRow => {
    activeBooking(d, bookingId);
    const item = d.prepare("SELECT * FROM tab_items WHERE id = ? AND booking_id = ?").get(itemId, bookingId) as
      | TabItemRow
      | undefined;
    if (!item) throw fail("That line is not on this bill.", 404);
    if (item.state === "VOID") throw fail("That line is already removed.", 409);
    if (item.state === "BILLED")
      throw fail("That line is already paid. Refund it by hand rather than removing it.", 409);
    const open = d
      .prepare("SELECT 1 FROM invoices WHERE booking_id = ? AND status = 'PENDING' AND expires_at > ? LIMIT 1")
      .get(bookingId, Date.now());
    if (open) throw fail("Cancel the open payment QR first, then change the bill.", 409);

    if (item.qty > 1) d.prepare("UPDATE tab_items SET qty = qty - 1 WHERE id = ?").run(itemId);
    else d.prepare("UPDATE tab_items SET state = 'VOID' WHERE id = ?").run(itemId);
    return d.prepare("SELECT * FROM tab_items WHERE id = ?").get(itemId) as TabItemRow;
  })();
}

export function addExtendHours(bookingId: string, hours: number): TabItemRow {
  const d = getDb();
  const booking = activeBooking(d, bookingId);
  if (!Number.isInteger(hours) || hours < 1 || hours > 6) throw fail("bad hours", 400);
  const room = getRoomById(booking.room_id);
  if (!room) throw fail("room not found", 404);
  const row: TabItemRow = {
    id: randomUUID(),
    booking_id: bookingId,
    kind: "ROOM_HOURS",
    menu_item_id: null,
    label: `Extra ${hours}h`,
    qty: hours,
    unit_price: room.hourly_rate,
    currency: shopCurrency(),
    state: "UNBILLED",
    created_at: Date.now(),
  };
  insertTabItem(d, row);
  return row;
}

// Invoices

export function getInvoice(id: string): InvoiceRow | undefined {
  return getDb().prepare("SELECT * FROM invoices WHERE id = ?").get(id) as InvoiceRow | undefined;
}

export function pendingInvoiceFor(bookingId: string): InvoiceRow | undefined {
  return getDb()
    .prepare("SELECT * FROM invoices WHERE booking_id = ? AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1")
    .get(bookingId) as InvoiceRow | undefined;
}

export function markInvoiceExpired(id: string): void {
  getDb().prepare("UPDATE invoices SET status = 'EXPIRED' WHERE id = ? AND status = 'PENDING'").run(id);
}

export function createInvoice(input: {
  id: string;
  bookingId: string;
  total: number;
  currency: Currency;
  qr: string;
  md5: string;
  lines: BookingLines;
  expiresAt: number;
}): InvoiceRow {
  getDb()
    .prepare(
      `INSERT INTO invoices(id, booking_id, total, currency, qr, md5, status, lines_json, expires_at, created_at)
       VALUES(?,?,?,?,?,?,'PENDING',?,?,?)`
    )
    .run(input.id, input.bookingId, input.total, input.currency, input.qr, input.md5, JSON.stringify(input.lines), input.expiresAt, Date.now());
  return getInvoice(input.id)!;
}

/** Marks the invoice PAID, flips its tab lines to BILLED and extends the stay, in one transaction. */
export function settleInvoicePaid(id: string): InvoiceRow | undefined {
  const d = getDb();
  return d.transaction((): InvoiceRow | undefined => {
    const inv = getInvoice(id);
    if (!inv || inv.status !== "PENDING") return inv;
    const lines = JSON.parse(inv.lines_json) as BookingLines;
    d.prepare("UPDATE invoices SET status = 'PAID' WHERE id = ?").run(id);
    if (lines.tabItemIds.length > 0) {
      const placeholders = lines.tabItemIds.map(() => "?").join(",");
      d.prepare(`UPDATE tab_items SET state = 'BILLED' WHERE id IN (${placeholders})`).run(...lines.tabItemIds);
    }
    if (lines.extendHours > 0) {
      d.prepare("UPDATE bookings SET ends_at = ends_at + ? WHERE id = ?").run(lines.extendHours * 3600_000, inv.booking_id);
    }
    return getInvoice(id);
  })();
}

export function closeBooking(bookingId: string): void {
  const d = getDb();
  d.transaction(() => {
    const booking = d.prepare("SELECT * FROM bookings WHERE id = ?").get(bookingId) as BookingRow | undefined;
    if (!booking) throw fail("booking not found", 404);
    if (booking.status !== "ACTIVE") throw fail("already closed", 409);
    const pending = d
      .prepare("SELECT 1 FROM invoices WHERE booking_id = ? AND status = 'PENDING' AND expires_at > ? LIMIT 1")
      .get(bookingId, Date.now());
    if (pending) throw fail("A payment QR is still waiting. Cancel it or wait for payment.", 409);
    if (unbilledTotal(bookingId) > 0) throw fail("Collect payment for the bill first.", 409);
    d.prepare("UPDATE bookings SET status = 'CLOSED' WHERE id = ?").run(bookingId);
    d.prepare("UPDATE rooms SET status = 'CLEANING' WHERE id = ?").run(booking.room_id);
  })();
}

/**
 * Voids unpaid lines and any open QR, then frees the room. The caller must first
 * rule out a QR that was paid but not yet settled (see the cancel route).
 */
export function cancelBooking(bookingId: string): { paid: { total: number; currency: Currency }[] } {
  const d = getDb();
  return d.transaction(() => {
    const booking = d.prepare("SELECT * FROM bookings WHERE id = ?").get(bookingId) as BookingRow | undefined;
    if (!booking) throw fail("booking not found", 404);
    if (booking.status !== "ACTIVE") throw fail("booking is not active", 409);
    d.prepare("UPDATE invoices SET status = 'EXPIRED' WHERE booking_id = ? AND status = 'PENDING'").run(bookingId);
    d.prepare("UPDATE tab_items SET state = 'VOID' WHERE booking_id = ? AND state = 'UNBILLED'").run(bookingId);
    d.prepare("UPDATE bookings SET status = 'CANCELLED' WHERE id = ?").run(bookingId);
    d.prepare("UPDATE rooms SET status = 'AVAILABLE' WHERE id = ?").run(booking.room_id);
    const paid = d
      .prepare("SELECT currency, SUM(total) AS total FROM invoices WHERE booking_id = ? AND status = 'PAID' GROUP BY currency")
      .all(bookingId) as { total: number; currency: Currency }[];
    return { paid };
  })();
}

export function listInvoices(limit = 50): (InvoiceRow & { room_code: string })[] {
  return getDb()
    .prepare(
      `SELECT i.*, r.code AS room_code FROM invoices i
       JOIN bookings b ON b.id = i.booking_id
       JOIN rooms r ON r.id = b.room_id
       ORDER BY i.created_at DESC LIMIT ?`
    )
    .all(limit) as (InvoiceRow & { room_code: string })[];
}

export function errStatus(e: unknown): number {
  if (typeof e === "object" && e !== null && "status" in e && typeof (e as { status: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return 500;
}
