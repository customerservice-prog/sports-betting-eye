import { NextResponse } from "next/server";
import { getPaperState, resetPaperStatePersistent } from "@/lib/persistence";
import { createInitialPaperState } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const state = (await getPaperState()) ?? createInitialPaperState();
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load paper state." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const state = await resetPaperStatePersistent();
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to reset paper state." },
      { status: 500 }
    );
  }
}
