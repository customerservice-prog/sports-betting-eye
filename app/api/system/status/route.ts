import { NextResponse } from "next/server";
import { getKnowledgeCounts, getSystemStats } from "@/lib/persistence";
import { getArchiveStats } from "@/lib/archive-ingestion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const [database, knowledge, archive] = await Promise.all([
      getSystemStats(),
      getKnowledgeCounts(),
      getArchiveStats()
    ]);
    return NextResponse.json({
      ok: true,
      service: "sports-eye",
      version: "0.2.0",
      dataMode: process.env.SPORTS_DATA_MODE || "demo",
      backgroundExploration: process.env.BACKGROUND_EXPLORATION_ENABLED === "true",
      database,
      knowledge,
      archive
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
