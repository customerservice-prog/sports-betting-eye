import { ESPNPublicProvider, ESPNReferenceProvider, fetchESPNGamePackage, sportsEyeLeagues } from "./providers/espn";
import {
  getNamedState,
  listGamesNeedingPackages,
  saveNamedState,
  upsertGamePackage,
  upsertProviderGames,
  upsertReferenceData
} from "./persistence";
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
  const configuredTargetRaw =
    process.env.HISTORICAL_TARGET_START ??
    process.env.HISTORICAL_BACKFILL_TARGET_START ??
    "2000-01-01T00:00:00.000Z";
  const parsedTarget = new Date(configuredTargetRaw);
  const configuredTarget = Number.isNaN(parsedTarget.getTime())
    ? new Date("2000-01-01T00:00:00.000Z")
    : utcDateOnly(parsedTarget);

  const existing = await (await import("./persistence")).getHistoricalBackfillState();
  const existingTarget = existing ? new Date(existing.targetStart) : null;
  if (
    existing?.complete &&
    existingTarget &&
    !Number.isNaN(existingTarget.getTime()) &&
    existingTarget.getTime() <= configuredTarget.getTime()
  ) {
    return { ...existing, gamesAdded: 0, errors: [] as Array<{ league: string; message: string }> };
  }

  const cursorEnd = existing ? new Date(existing.cursorEnd) : defaultCursor;
  const storedTarget = existingTarget && !Number.isNaN(existingTarget.getTime())
    ? existingTarget
    : configuredTarget;
  const targetStart = storedTarget.getTime() > configuredTarget.getTime()
    ? configuredTarget
    : storedTarget;
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


export async function ingestReferenceKnowledge(input?: { force?: boolean; maxLeagues?: number }) {
  const refreshHours = Math.max(1, Number(process.env.REFERENCE_REFRESH_HOURS || 6));
  const perRun = Math.max(
    1,
    Math.min(
      sportsEyeLeagues.length,
      input?.maxLeagues ?? Number(process.env.REFERENCE_LEAGUES_PER_RUN || 1)
    )
  );
  const state = await getNamedState<{
    lastCycleCompletedAt?: string;
    nextLeagueIndex?: number;
  }>("reference_ingestion");

  const startIndex = Math.max(0, Math.min(
    sportsEyeLeagues.length - 1,
    Number(state?.nextLeagueIndex ?? 0)
  ));
  const lastCycle = state?.lastCycleCompletedAt
    ? new Date(state.lastCycleCompletedAt).getTime()
    : 0;
  const atCycleStart = startIndex === 0;
  const due = input?.force || !atCycleStart || !lastCycle ||
    Date.now() - lastCycle >= refreshHours * 60 * 60 * 1000;

  if (!due) {
    return {
      skipped: true,
      reason: "refresh-window",
      lastCompletedAt: state?.lastCycleCompletedAt ?? null,
      totals: { teams: 0, players: 0, injuries: 0, transactions: 0 },
      leaguesProcessed: [] as string[],
      errors: [] as Array<{ league: string; message: string }>
    };
  }

  const provider = new ESPNReferenceProvider();
  const totals = { teams: 0, players: 0, injuries: 0, transactions: 0 };
  const errors: Array<{ league: string; message: string }> = [];
  const leaguesProcessed: string[] = [];

  let nextIndex = startIndex;
  for (let offset = 0; offset < perRun; offset += 1) {
    const index = (startIndex + offset) % sportsEyeLeagues.length;
    const league = sportsEyeLeagues[index];
    leaguesProcessed.push(league);
    try {
      const bundle = await provider.getReferenceBundle(league);
      const stored = await upsertReferenceData(provider.name, {
        ...bundle,
        capturedAt: new Date().toISOString()
      });
      totals.teams += stored.teams;
      totals.players += stored.players;
      totals.injuries += stored.injuries;
      totals.transactions += stored.transactions;
    } catch (error) {
      errors.push({
        league,
        message: error instanceof Error ? error.message : "Reference ingestion failed"
      });
    }
    nextIndex = (index + 1) % sportsEyeLeagues.length;
  }

  const completedAt = new Date().toISOString();
  const cycleCompleted = nextIndex === 0;
  await saveNamedState("reference_ingestion", {
    nextLeagueIndex: nextIndex,
    lastCycleCompletedAt: cycleCompleted
      ? completedAt
      : state?.lastCycleCompletedAt ?? null,
    lastRunAt: completedAt,
    lastLeaguesProcessed: leaguesProcessed,
    lastTotals: totals,
    lastErrors: errors
  });

  return {
    skipped: false,
    completedAt,
    cycleCompleted,
    nextLeagueIndex: nextIndex,
    totals,
    leaguesProcessed,
    errors
  };
}

export async function hydrateGamePackages(limit = 12) {
  const games = await listGamesNeedingPackages(limit);
  let stored = 0;
  const errors: Array<{ gameId: string; message: string }> = [];

  for (const game of games) {
    if (game.provider !== "espn-public") continue;
    try {
      const league = game.league as League;
      const payload = await fetchESPNGamePackage(league, game.providerGameId);
      await upsertGamePackage(game.id, game.provider, payload);
      stored += 1;
    } catch (error) {
      errors.push({
        gameId: game.id,
        message: error instanceof Error ? error.message : "Game package hydration failed"
      });
    }
  }

  return { attempted: games.length, stored, errors };
}
