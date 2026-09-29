import { League } from "../types";

const ROUTES: Record<League, { sport: string; league: string; teamLimit: number }> = {
  NFL: { sport: "football", league: "nfl", teamLimit: 64 },
  NBA: { sport: "basketball", league: "nba", teamLimit: 64 },
  MLB: { sport: "baseball", league: "mlb", teamLimit: 64 },
  NHL: { sport: "hockey", league: "nhl", teamLimit: 64 },
  NCAAF: { sport: "football", league: "college-football", teamLimit: 500 },
  NCAAB: { sport: "basketball", league: "mens-college-basketball", teamLimit: 700 }
};

export type ESPNTeam = {
  id: string;
  name: string;
  displayName: string;
  abbreviation: string;
  raw: Record<string, unknown>;
};

export type ESPNPlayer = {
  id: string;
  displayName: string;
  fullName: string;
  position: string;
  jersey: string;
  age: number | null;
  status: string;
  raw: Record<string, unknown>;
};

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "SportsEye/0.4 intelligence-ingestion"
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`ESPN request failed: ${response.status} ${url}`);
  return response.json() as Promise<any>;
}

function siteBase(league: League) {
  const route = ROUTES[league];
  return `https://site.api.espn.com/apis/site/v2/sports/${route.sport}/${route.league}`;
}

function commonBase(league: League) {
  const route = ROUTES[league];
  return `https://site.web.api.espn.com/apis/common/v3/sports/${route.sport}/${route.league}`;
}

function flattenRoster(payload: any): any[] {
  if (Array.isArray(payload?.athletes)) {
    return payload.athletes.flatMap((group: any) => {
      if (Array.isArray(group?.items)) return group.items;
      return group?.id || group?.uid ? [group] : [];
    });
  }
  return [];
}

export class ESPNIntelligenceProvider {
  readonly name = "espn-public";

  async getTeams(league: League): Promise<ESPNTeam[]> {
    const route = ROUTES[league];
    const payload = await fetchJson(`${siteBase(league)}/teams?limit=${route.teamLimit}`);
    const teams =
      payload?.sports?.[0]?.leagues?.[0]?.teams ??
      payload?.teams ??
      [];

    return teams.flatMap((entry: any) => {
      const team = entry?.team ?? entry;
      if (!team?.id || !(team?.displayName || team?.name)) return [];
      return [{
        id: String(team.id),
        name: String(team.name ?? team.displayName),
        displayName: String(team.displayName ?? team.name),
        abbreviation: String(team.abbreviation ?? ""),
        raw: team
      }];
    });
  }

  async getRoster(league: League, teamId: string): Promise<{ raw: any; players: ESPNPlayer[] }> {
    const payload = await fetchJson(`${siteBase(league)}/teams/${teamId}/roster`);
    const players = flattenRoster(payload).flatMap((athlete: any) => {
      if (!athlete?.id || !(athlete?.displayName || athlete?.fullName)) return [];
      return [{
        id: String(athlete.id),
        displayName: String(athlete.displayName ?? athlete.fullName),
        fullName: String(athlete.fullName ?? athlete.displayName),
        position: String(athlete?.position?.abbreviation ?? athlete?.position?.name ?? ""),
        jersey: String(athlete?.jersey ?? ""),
        age: Number.isFinite(Number(athlete?.age)) ? Number(athlete.age) : null,
        status: String(athlete?.status?.type ?? athlete?.status?.name ?? athlete?.status ?? "unknown"),
        raw: athlete
      }];
    });
    return { raw: payload, players };
  }

  async getLeagueInjuries(league: League) {
    return fetchJson(`${siteBase(league)}/injuries`);
  }

  async getTeamInjuries(league: League, team: string) {
    return fetchJson(`${siteBase(league)}/injuries?team=${encodeURIComponent(team)}`);
  }

  async getTeamStatistics(league: League, teamId: string) {
    return fetchJson(`${siteBase(league)}/teams/${teamId}/statistics`);
  }

  async getTeamDepthChart(league: League, teamId: string) {
    const base = siteBase(league);
    try {
      return await fetchJson(`${base}/teams/${teamId}/depthcharts`);
    } catch {
      return fetchJson(`${base}/teams/${teamId}/depth-charts`);
    }
  }

  async getStandings(league: League) {
    const route = ROUTES[league];
    return fetchJson(`https://site.api.espn.com/apis/v2/sports/${route.sport}/${route.league}/standings`);
  }

  async getTransactions(league: League) {
    return fetchJson(`${siteBase(league)}/transactions`);
  }

  async getGameSummary(league: League, eventId: string) {
    return fetchJson(`${siteBase(league)}/summary?event=${encodeURIComponent(eventId)}`);
  }

  async getAthleteOverview(league: League, athleteId: string) {
    return fetchJson(`${commonBase(league)}/athletes/${athleteId}/overview`);
  }

  async getAthleteStats(league: League, athleteId: string) {
    return fetchJson(`${commonBase(league)}/athletes/${athleteId}/stats`);
  }
}

export const intelligenceLeagues: League[] = ["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB"];
