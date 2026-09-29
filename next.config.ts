import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a second server or build run beside `npm run dev` without sharing .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
