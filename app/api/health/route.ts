import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "sports-eye",
    version: "0.1.0",
    dataMode: process.env.SPORTS_DATA_MODE || "demo",
    realMoneyExecution: false,
    timestamp: new Date().toISOString()
  });
}
