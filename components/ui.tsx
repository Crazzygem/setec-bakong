"use client";

import Link from "next/link";
import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "tertiary" | "tertiary-danger" | "danger";

const base =
  "inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-colors disabled:cursor-not-allowed";
const sizes = { md: "min-h-12 px-6 text-base", sm: "min-h-11 px-4 text-sm" } as const;
const variants: Record<Variant, string> = {
  primary: "bg-primary-fill text-white hover:bg-primary-press active:bg-primary-press disabled:bg-primary-disabled",
  secondary: "border border-ink bg-canvas text-ink hover:bg-surface-soft disabled:border-field disabled:text-muted",
  // Text-only buttons carry no side padding so they line up with body copy.
  tertiary: "!px-0 text-ink underline-offset-4 hover:underline disabled:text-muted",
  "tertiary-danger": "!px-0 text-error underline-offset-4 hover:underline disabled:opacity-60",
  danger: "border border-error bg-canvas text-error hover:bg-surface-soft disabled:opacity-60",
};

export function buttonClass(variant: Variant = "primary", size: keyof typeof sizes = "md", extra = "") {
  return `${base} ${sizes[size]} ${variants[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/** DESIGN.md text-input: 56px, label above, 2px ink border on focus. */
export function Field({
  label,
  hint,
  error,
  id,
  prefix,
  className = "",
  ...input
}: ComponentProps<"input"> & {
  label: string;
  hint?: string;
  error?: string | null;
  id: string;
  /** Currency or unit marker drawn inside the field, e.g. "$" or "៛". */
  prefix?: string;
}) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  const control = (
    <input
      id={id}
      aria-invalid={!!error || undefined}
      aria-describedby={describedBy}
      className={`mt-1 block h-14 w-full rounded-sm border bg-canvas text-base text-ink placeholder:text-muted focus:border-2 focus:outline-none aria-invalid:border-error ${
        prefix ? "pl-9 pr-3 focus:pl-[35px]" : "px-3 focus:px-[11px]"
      } ${error ? "border-error" : "border-field focus:border-ink"}`}
      {...input}
    />
  );
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-muted">
        {label}
      </label>
      {prefix ? (
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute top-1 left-3 z-10 flex h-12 items-center text-base text-muted"
          >
            {prefix}
          </span>
          {control}
        </div>
      ) : (
        control
      )}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** DESiGN.md modal scrim: #000 at 50%. `::backdrop` needs a pseudo-element, so it lives in globals.css. */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        // Clicks land on the dialog itself only when they hit the backdrop.
        if (e.target === ref.current) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-md border border-hairline bg-canvas p-0 shadow-float backdrop:bg-black/50"
    >
      <div className="flex max-h-[calc(100dvh-32px)] flex-col">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline-soft px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-sm text-xl text-muted hover:bg-surface-soft hover:text-ink"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
        {/* Clicking the padding outside the dialog box closes it, same as the scrim. */}
      </div>
    </dialog>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error"; children: ReactNode }) {
  return tone === "error" ? (
    <p role="alert" className="rounded-sm border border-error bg-canvas px-4 py-3 text-sm text-error">
      {children}
    </p>
  ) : (
    <p role="status" className="rounded-sm bg-surface-soft px-4 py-3 text-sm text-body">
      {children}
    </p>
  );
}

export type RoomStatus = "AVAILABLE" | "OCCUPIED" | "CLEANING";

// Shape plus words, never colour alone: free is an outline ring, in use is filled.
const statusStyle: Record<RoomStatus, { label: string; dot: string }> = {
  AVAILABLE: { label: "Available", dot: "border-2 border-ink bg-canvas" },
  OCCUPIED: { label: "In use", dot: "bg-primary" },
  CLEANING: { label: "Cleaning", dot: "bg-field" },
};

export function RoomStatusLabel({ status, className = "" }: { status: RoomStatus; className?: string }) {
  const s = statusStyle[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${className}`}>
      <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="text-lg font-bold tracking-tight text-ink">
      Bakong Cinema Rooms
    </Link>
  );
}
