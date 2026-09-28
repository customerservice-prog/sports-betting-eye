import { League } from "../types";
import { FeedGame } from "../persistence";

const ROUTES: Record<League, { sport: string; league: string; params?: Record<string, string> }> = {
  NFL: { sport: "football", league: "nfl" },
  NBA: { sport: "basketball", league: "nba" },
  MLB: { sport: "baseball", league: "mlb" },
  NHL: { sport: "hockey", league: "nhl" },
  NCAAF: { sport: "football", league: "college-football", params: { groups: "80", limit: "500" } },
  NCAAB: { sport: "basketball", league: "mens-college-basketball", params: { limit: "500" } }
};

type Competitor = {
  homeAway?: "home" | "away";
  score?: string;
  records?: Array<{ name?: string; summary?: string }>;
  team?: { displayName?: string; abbreviation?: string };
};

function recordOf(team?: Competitor) {
  return team?.records?.find((record) => record.name === "overall")?.summary
    ?? team?.records?.[0]?.summary
    ?? "";
}

function normalizedStatus(state?: string, completed?: boolean): FeedGame["status"] {
  if (completed || state === "post") return "final";
  if (state === "in") return "live";
  return "scheduled";
}

export class ESPNPublicProvider {
  readonly name = "espn-public";

  async getCurrentScoreboard(league: League): Promise<FeedGame[]> {
    const route = ROUTES[league];
    const params = new URLSearchParams(route.params ?? {});
    const query = params.toString();
    const url =
      `https://site.api.espn.com/apis/site/v2/sports/${route.sport}/${route.league}/scoreboard` +
      (query ? `?${query}` : "");

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "SportsEye/0.3 schedule-ingestion"
      },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`ESPN scoreboard request failed for ${league}: ${response.status}`);
    }

    const payload = await response.json() as { events?: any[] };
    const capturedAt = new Date().toISOString();

    return (payload.events ?? []).flatMap((event) => {
      const competition = event?.competitions?.[0];
      if (!competition) return [];

      const competitors = (competition.competitors ?? []) as Competitor[];
      const home = competitors.find((item) => item.homeAway === "home");
      const away = competitors.find((item) => item.homeAway === "away");
      if (!home?.team?.displayName || !away?.team?.displayName || !event?.id || !event?.date) {
        return [];
      }

      const statusType = competition?.status?.type;
      const parsedHome = Number.parseInt(home.score ?? "", 10);
      const parsedAway = Number.parseInt(away.score ?? "", 10);
      const statusDetail =
        statusType?.shortDetail ?? statusType?.detail ?? statusType?.description ?? "";

      return [{
        providerGameId: String(event.id),
        league,
        startsAt: String(event.date),
        homeTeam: home.team.displayName,
        awayTeam: away.team.displayName,
        homeAbbreviation: home.team.abbreviation ?? home.team.displayName.slice(0, 3).toUpperCase(),
        awayAbbreviation: away.team.abbreviation ?? away.team.displayName.slice(0, 3).toUpperCase(),
        homeRecord: recordOf(home),
        awayRecord: recordOf(away),
        venue: competition?.venue?.fullName ?? "",
        status: normalizedStatus(statusType?.state, Boolean(statusType?.completed)),
        statusDetail,
        homeScore: Number.isFinite(parsedHome) ? parsedHome : undefined,
        awayScore: Number.isFinite(parsedAway) ? parsedAway : undefined,
        sourceUpdatedAt: capturedAt,
        raw: {
          eventId: String(event.id),
          shortName: event.shortName ?? "",
          statusDetail,
          venue: competition?.venue?.fullName ?? "",
          homeAbbreviation: home.team.abbreviation ?? "",
          awayAbbreviation: away.team.abbreviation ?? "",
          homeRecord: recordOf(home),
          awayRecord: recordOf(away)
        }
      }];
    });
  }
}

export const sportsEyeLeagues: League[] = ["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB"];
