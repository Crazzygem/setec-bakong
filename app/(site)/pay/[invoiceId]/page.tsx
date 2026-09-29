"use client";

import Link from "next/link";
import { use, useState } from "react";
import { KhqrPayment } from "@/components/khqr-payment";

export default function PayPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = use(params);
  const [settled, setSettled] = useState<"PAID" | "EXPIRED" | null>(null);

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:py-16">
      <div className="rounded-md border border-hairline bg-canvas p-6 shadow-float">
        <h1 className="mb-4 text-center text-base font-semibold">Pay with KHQR</h1>
        <KhqrPayment invoiceId={invoiceId} onSettled={setSettled} showSave />
      </div>
      {settled && (
        <p className="mt-6 text-center text-sm">
          <Link href="/" className="font-medium text-ink underline">
            Back to the start page
          </Link>
        </p>
      )}
    </div>
  );
}
