import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { CurrencyProvider } from "@/components/currency";
import { describeSettlement, shopCurrency } from "@/lib/shop";
import "./globals.css";

// DESIGN.md names Inter as the open substitute for its licensed display face.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Bakong Cinema Rooms",
  description: "Private cinema rooms by the hour, paid with Bakong KHQR.",
};

// Read SHOP_CURRENCY per request rather than baking it in at build time.
export const dynamic = "force-dynamic";

// A currency that the settlement account cannot take fails at the till, so say it at boot.
console.log(describeSettlement());

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh antialiased">
        <CurrencyProvider currency={shopCurrency()}>{children}</CurrencyProvider>
      </body>
    </html>
  );
}
