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
