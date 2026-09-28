import { NextRequest, NextResponse } from "next/server";
import { runPersistentExplorationBatch } from "@/lib/persistence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const batchSize = Number(body.batchSize ?? 250);
    const state = await runPersistentExplorationBatch(batchSize);
    return NextResponse.json({ ok: true, state, batchSize: Math.floor(batchSize) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Exploration batch failed." },
      { status: 500 }
    );
  }
}
