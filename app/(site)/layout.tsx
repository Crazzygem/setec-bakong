import { SiteFooter, SiteHeader } from "@/components/site-header";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="no-print">
        <SiteHeader />
      </div>
      <main className="flex-1">{children}</main>
      <div className="no-print">
        <SiteFooter />
      </div>
    </div>
  );
}
