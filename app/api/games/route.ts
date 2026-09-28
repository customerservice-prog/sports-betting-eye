import { NextRequest, NextResponse } from "next/server";
import { getHistoricalBackfillState, listLiveGamesWithBaseline } from "@/lib/persistence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams;
    const [games, backfill] = await Promise.all([
      listLiveGamesWithBaseline({
      pastHours: Number(search.get("pastHours") ?? 18),
      futureHours: Number(search.get("futureHours") ?? 120),
        limit: Number(search.get("limit") ?? 100)
      }),
      getHistoricalBackfillState()
    ]);

    return NextResponse.json({
      ok: true,
      source: "espn-public",
      sourceLabel: "ESPN public scoreboard (unofficial API)",
      proofGrade: false,
      baselineLabel: "Elo baseline from completed real games — research only",
      historicalBackfill: backfill,
      games
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, games: [], error: error instanceof Error ? error.message : "Unable to load games." },
      { status: 500 }
    );
  }
}
