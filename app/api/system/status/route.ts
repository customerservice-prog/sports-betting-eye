import { NextResponse } from "next/server";
import { getSystemStats } from "@/lib/persistence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const database = await getSystemStats();
    return NextResponse.json({
      ok: true,
      service: "sports-eye",
      version: "0.2.0",
      dataMode: process.env.SPORTS_DATA_MODE || "demo",
      backgroundExploration: process.env.BACKGROUND_EXPLORATION_ENABLED === "true",
      database
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        service: "sports-eye",
        version: "0.2.0",
        dataMode: process.env.SPORTS_DATA_MODE || "demo",
        error: error instanceof Error ? error.message : "System status unavailable."
      },
      { status: 500 }
    );
  }
}
