"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMoney } from "@/components/currency";
import { RoomStatusLabel, type RoomStatus } from "@/components/ui";

interface Room {
  id: string;
  code: string;
  name: string;
  hourly_rate: number;
  capacity: number;
  status: RoomStatus;
}

function RoomCodeSearch() {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <form
      role="search"
      aria-label="Open your room"
      onSubmit={(e) => {
        e.preventDefault();
        const c = code.trim().toUpperCase();
        if (c) router.push(`/t/${encodeURIComponent(c)}`);
      }}
      className="flex h-16 w-full max-w-xl items-center rounded-full border border-hairline bg-canvas py-2 pr-2 pl-6 shadow-float"
    >
      <label htmlFor="room-code" className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs font-semibold text-ink">Your room</span>
        <input
          id="room-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Code on the door, e.g. A1"
          maxLength={12}
          autoCapitalize="characters"
          autoComplete="off"
          className="w-full bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
        />
      </label>
      <button
        type="submit"
        aria-label="Open room"
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary-fill text-white hover:bg-primary-press"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </form>
  );
}

function RoomGrid() {
  const money = useMoney();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/rooms")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRooms(d.rooms ?? []))
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="text-sm text-error">Rooms could not load. Refresh the page to try again.</p>;
  if (!rooms) return <p className="text-sm text-muted">Loading rooms…</p>;
  if (rooms.length === 0)
    return (
      <p className="text-sm text-muted">
        No rooms are set up yet. Staff can add them in{" "}
        <Link href="/admin" className="font-medium text-ink underline">
          Admin
        </Link>
        .
      </p>
    );

  return (
    <ul className="grid grid-cols-1 gap-x-4 gap-y-8 min-[520px]:grid-cols-2 lg:grid-cols-4">
      {rooms.map((r) => (
        <li key={r.id}>
          <Link href={`/t/${r.code}`} className="group block rounded-md">
            <div className="grid aspect-[4/3] place-items-center rounded-md bg-surface-strong transition-shadow group-hover:shadow-float">
              <span className="text-[56px] leading-none font-bold tracking-tight text-ink">{r.code}</span>
            </div>
            <div className="mt-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{r.name}</p>
                <p className="text-sm text-muted">{r.capacity} seats</p>
              </div>
              <RoomStatusLabel status={r.status} className="shrink-0 text-body" />
            </div>
            <p className="mt-1 text-sm">
              <span className="font-semibold tabular-nums">{money(r.hourly_rate)}</span> per hour
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function Home() {
  return (
    <>
      <section className="border-b border-hairline-soft">
        <div className="mx-auto max-w-[1280px] px-4 pt-10 pb-12 sm:px-6 md:pt-16 md:pb-16 lg:px-10">
          <h1 className="max-w-xl text-2xl leading-snug font-bold md:text-[28px]">
            Private cinema rooms by the hour. Order snacks from your seat, pay with KHQR.
          </h1>
          <p className="mt-3 max-w-xl text-body">
            Already checked in? Enter the code on your room door to see your bill, add snacks or extend your time.
          </p>
          <div className="mt-8">
            <RoomCodeSearch />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6 md:py-16 lg:px-10">
        <h2 className="text-xl font-semibold md:text-[22px]">Rooms</h2>
        <p className="mt-1 mb-6 text-sm text-muted">Check in at the counter. Staff start your time, then you can pay at the counter or from your seat.</p>
        <RoomGrid />
      </section>

      <section className="bg-surface-soft">
        <div className="mx-auto grid max-w-[1280px] gap-6 px-4 py-10 sm:px-6 md:grid-cols-[1fr_2fr] md:py-16 lg:px-10">
          <h2 className="text-xl font-semibold md:text-[22px]">How paying works</h2>
          <div className="space-y-3 text-body">
            <p>
              Each bill becomes its own KHQR code with the exact amount already filled in. Scan it with ABA, ACLEDA, Bakong or
              any other app that reads KHQR, then confirm.
            </p>
            <p>The code closes after five minutes. Your screen changes to paid as soon as the bank confirms the transfer.</p>
          </div>
        </div>
      </section>
    </>
  );
}
