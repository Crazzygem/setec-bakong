"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/ui";

const links = [
  { href: "/staff", label: "Staff POS" },
  { href: "/admin", label: "Admin" },
];

/** Two destinations fit at 360px, so they stay visible instead of hiding behind a menu. */
export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="border-b border-hairline bg-canvas">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-4 px-4 sm:px-6 md:h-20 lg:px-10">
        <Wordmark />
        <nav aria-label="Main" className="flex items-center gap-4 sm:gap-6">
          {links.map((l) => {
            const active = path === l.href || path.startsWith(`${l.href}/`);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center border-b-2 text-sm font-semibold sm:text-base ${
                  active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline bg-canvas">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-2 px-4 py-8 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
        <p>SETEC e-commerce class project. Payments settle through Bakong KHQR.</p>
        <p>Not a commercial service.</p>
      </div>
    </footer>
  );
}
