import { demoGames } from "@/lib/seed-data";
import { League } from "@/lib/types";
import { ProviderGame, SportsDataProvider } from "./types";

export class DemoSportsProvider implements SportsDataProvider {
  readonly name = "demo";

  async getSchedule(input: { league: League; from: string; to: string }): Promise<ProviderGame[]> {
    return demoGames
      .filter((game) => game.league === input.league)
      .map((game) => ({
        providerGameId: game.id,
        league: game.league,
        startsAt: new Date().toISOString(),
        homeTeam: game.home.name,
        awayTeam: game.away.name,
        status: "scheduled" as const,
        sourceUpdatedAt: new Date().toISOString()
      }));
  }
}
