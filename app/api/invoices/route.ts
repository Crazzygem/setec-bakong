import { NextResponse } from "next/server";
import { listInvoices } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ invoices: listInvoices() });
}
