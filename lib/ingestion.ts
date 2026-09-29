import { ESPNPublicProvider, sportsEyeLeagues } from "./providers/espn";
import { upsertProviderGames } from "./persistence";
import { League } from "./types";

export type IngestionResult = {
  provider: string;
  totalGames: number;
  byLeague: Partial<Record<League, number>>;
  errors: Array<{ league: string; message: string }>;
  completedAt: string;
};

export async function ingestCurrentSportsData(): Promise<IngestionResult> {
  const provider = new ESPNPublicProvider();
  const byLeague: Partial<Record<League, number>> = {};
  const errors: IngestionResult["errors"] = [];
  let totalGames = 0;

  const results = await Promise.all(
    sportsEyeLeagues.map(async (league) => {
      try {
        const games = await provider.getCurrentScoreboard(league);
        const stored = await upsertProviderGames(provider.name, games);
        return { league, stored, error: "" };
      } catch (error) {
        return {
          league,
          stored: 0,
          error: error instanceof Error ? error.message : "Unknown ingestion failure"
        };
      }
    })
  );

  for (const result of results) {
    byLeague[result.league] = result.stored;
    totalGames += result.stored;
    if (result.error) errors.push({ league: result.league, message: result.error });
  }

  return {
    provider: provider.name,
    totalGames,
    byLeague,
    errors,
    completedAt: new Date().toISOString()
  };
}

function utcDateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function backfillHistoricalChunk(daysPerChunk = 7) {
  const provider = new ESPNPublicProvider();
  const now = new Date();
  const today = utcDateOnly(now);
  const defaultCursor = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const configuredTarget = process.env.HISTORICAL_BACKFILL_TARGET_START || "1970-01-01T00:00:00.000Z";
  const parsedTarget = new Date(configuredTarget);
  const defaultTarget = Number.isNaN(parsedTarget.getTime())
    ? new Date("1970-01-01T00:00:00.000Z")
    : utcDateOnly(parsedTarget);

  const existing = await (await import("./persistence")).getHistoricalBackfillState();
  if (existing?.complete) {
    return { ...existing, gamesAdded: 0, errors: [] as Array<{ league: string; message: string }> };
  }

  const cursorEnd = existing ? new Date(existing.cursorEnd) : defaultCursor;
  const targetStart = existing ? new Date(existing.targetStart) : defaultTarget;
  const candidateStart = new Date(cursorEnd.getTime() - (Math.max(1, daysPerChunk) - 1) * 24 * 60 * 60 * 1000);
  const chunkStart = candidateStart < targetStart ? targetStart : candidateStart;

  let gamesAdded = 0;
  const errors: Array<{ league: string; message: string }> = [];

  const results = await Promise.all(
    sportsEyeLeagues.map(async (league) => {
      try {
        const games = await provider.getRange(league, chunkStart, cursorEnd);
        const stored = await upsertProviderGames(provider.name, games);
        return { league, stored, error: "" };
      } catch (error) {
        return {
          league,
          stored: 0,
          error: error instanceof Error ? error.message : "Historical fetch failed"
        };
      }
    })
  );

  for (const result of results) {
    gamesAdded += result.stored;
    if (result.error) errors.push({ league: result.league, message: result.error });
  }

  const reachedTarget = chunkStart.getTime() <= targetStart.getTime();
  const nextCursor = new Date(chunkStart.getTime() - 24 * 60 * 60 * 1000);
  const nextState = {
    cursorEnd: (reachedTarget ? chunkStart : nextCursor).toISOString(),
    targetStart: targetStart.toISOString(),
    complete: reachedTarget && errors.length === 0,
    chunksCompleted: (existing?.chunksCompleted ?? 0) + 1,
    gamesStored: (existing?.gamesStored ?? 0) + gamesAdded,
    updatedAt: new Date().toISOString()
  };

  if (errors.length === 0) {
    await (await import("./persistence")).saveHistoricalBackfillState(nextState);
  }

  return { ...nextState, gamesAdded, errors };
}
