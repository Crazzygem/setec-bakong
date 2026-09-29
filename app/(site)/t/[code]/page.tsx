import { notFound } from "next/navigation";
import { getRoomByCode } from "@/lib/db";
import RoomClient from "./room-client";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const room = getRoomByCode(decodeURIComponent(code));
  if (!room) notFound();
  return <RoomClient code={room.code} />;
}
