import { League } from "../types";
import { FeedGame } from "../persistence";

export const ROUTES: Record<League, { sport: string; league: string; params?: Record<string, string> }> = {
  NFL: { sport: "football", league: "nfl", params: { limit: "1000" } },
  NBA: { sport: "basketball", league: "nba", params: { limit: "1000" } },
  MLB: { sport: "baseball", league: "mlb", params: { limit: "1000" } },
  NHL: { sport: "hockey", league: "nhl", params: { limit: "1000" } },
  NCAAF: { sport: "football", league: "college-football", params: { groups: "80", limit: "500" } },
  NCAAB: { sport: "basketball", league: "mens-college-basketball", params: { limit: "1000" } }
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
    return this.fetchScoreboard(league);
  }

  async getRange(league: League, from: Date, to: Date): Promise<FeedGame[]> {
    const format = (date: Date) =>
      `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
    return this.fetchScoreboard(league, `${format(from)}-${format(to)}`);
  }

  private async fetchScoreboard(league: League, dates?: string): Promise<FeedGame[]> {
    const route = ROUTES[league];
    const params = new URLSearchParams(route.params ?? {});
    if (dates) params.set("dates", dates);
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


type TeamRef = {
  id?: string | number;
  uid?: string;
  displayName?: string;
  name?: string;
  abbreviation?: string;
  location?: string;
};

function collectAthletes(node: unknown, output: any[] = []): any[] {
  if (!node || typeof node !== "object") return output;
  if (Array.isArray(node)) {
    for (const item of node) collectAthletes(item, output);
    return output;
  }
  const object = node as Record<string, any>;
  if (
    (object.id || object.uid) &&
    (object.fullName || object.displayName || (object.firstName && object.lastName)) &&
    (object.position || object.jersey || object.age || object.height || object.weight)
  ) {
    output.push(object);
  }
  for (const value of Object.values(object)) collectAthletes(value, output);
  return output;
}

function teamList(payload: any): TeamRef[] {
  const candidates =
    payload?.sports?.[0]?.leagues?.[0]?.teams ??
    payload?.leagues?.[0]?.teams ??
    payload?.teams ??
    [];
  return (Array.isArray(candidates) ? candidates : []).map((item: any) => item?.team ?? item).filter(Boolean);
}

export type ESPNReferenceBundle = {
  teams: Array<{
    providerTeamId: string;
    league: League;
    name: string;
    abbreviation?: string;
    location?: string;
    raw?: Record<string, unknown>;
  }>;
  players: Array<{
    providerPlayerId: string;
    league: League;
    fullName: string;
    firstName?: string;
    lastName?: string;
    position?: string;
    jersey?: string;
    height?: string;
    weight?: string;
    age?: number;
    experience?: string;
    active?: boolean;
    teamProviderId?: string;
    starter?: boolean;
    depthOrder?: number;
    rosterStatus?: string;
    raw?: Record<string, unknown>;
  }>;
  injuries: Array<{
    providerInjuryId: string;
    league: League;
    playerProviderId?: string;
    teamProviderId?: string;
    status?: string;
    bodyPart?: string;
    detail?: string;
    estimatedReturnDate?: string;
    raw?: Record<string, unknown>;
  }>;
  transactions: Array<{
    providerTransactionId: string;
    league: League;
    playerProviderId?: string;
    teamProviderId?: string;
    transactionType?: string;
    detail?: string;
    occurredAt?: string;
    raw?: Record<string, unknown>;
  }>;
};

export class ESPNReferenceProvider {
  readonly name = "espn-public";

  private async siteFetch(league: League, resource: string) {
    const route = ROUTES[league];
    const url = `https://site.api.espn.com/apis/site/v2/sports/${route.sport}/${route.league}/${resource}`;
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "SportsEye/0.5 reference-ingestion"
      },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`ESPN ${resource} request failed for ${league}: ${response.status}`);
    return response.json();
  }

  async getReferenceBundle(league: League): Promise<ESPNReferenceBundle> {
    const teamsPayload = await this.siteFetch(league, "teams");
    const teams = teamList(teamsPayload);
    const bundle: ESPNReferenceBundle = { teams: [], players: [], injuries: [], transactions: [] };

    for (const team of teams) {
      const teamId = String(team.id ?? team.uid ?? "");
      if (!teamId) continue;
      bundle.teams.push({
        providerTeamId: teamId,
        league,
        name: team.displayName ?? team.name ?? teamId,
        abbreviation: team.abbreviation,
        location: team.location,
        raw: team as Record<string, unknown>
      });

      const [rosterResult, injuryResult] = await Promise.allSettled([
        this.siteFetch(league, `teams/${teamId}/roster`),
        this.siteFetch(league, `teams/${teamId}/injuries`)
      ]);

      if (rosterResult.status === "fulfilled") {
        const athletes = collectAthletes(rosterResult.value);
        const seen = new Set<string>();
        for (const athlete of athletes) {
          const athleteId = String(athlete.id ?? athlete.uid ?? "");
          if (!athleteId || seen.has(athleteId)) continue;
          seen.add(athleteId);
          bundle.players.push({
            providerPlayerId: athleteId,
            league,
            fullName: athlete.fullName ?? athlete.displayName ?? [athlete.firstName, athlete.lastName].filter(Boolean).join(" "),
            firstName: athlete.firstName,
            lastName: athlete.lastName,
            position: athlete.position?.abbreviation ?? athlete.position?.name ?? athlete.position,
            jersey: athlete.jersey ? String(athlete.jersey) : undefined,
            height: athlete.displayHeight ?? athlete.height ? String(athlete.displayHeight ?? athlete.height) : undefined,
            weight: athlete.displayWeight ?? athlete.weight ? String(athlete.displayWeight ?? athlete.weight) : undefined,
            age: Number.isFinite(Number(athlete.age)) ? Number(athlete.age) : undefined,
            experience: athlete.experience?.displayValue ?? athlete.experience?.years?.toString?.(),
            active: typeof athlete.active === "boolean" ? athlete.active : undefined,
            teamProviderId: teamId,
            rosterStatus: athlete.status?.name ?? athlete.status?.type ?? athlete.status,
            raw: athlete
          });
        }
      }

      if (injuryResult.status === "fulfilled") {
        const root = injuryResult.value as any;
        const injuries = Array.isArray(root?.injuries)
          ? root.injuries
          : Array.isArray(root?.team?.injuries)
            ? root.team.injuries
            : collectAthletes(root).flatMap((athlete: any) =>
                (athlete.injuries ?? []).map((injury: any) => ({ ...injury, athlete }))
              );

        for (let i = 0; i < injuries.length; i += 1) {
          const injury = injuries[i];
          const athlete = injury.athlete ?? injury.player ?? injury;
          const playerId = athlete?.id ?? athlete?.uid ?? injury?.athlete?.id;
          const injuryId = injury.id ?? injury.uid ?? `${teamId}-${playerId ?? "unknown"}-${injury.date ?? injury.status ?? i}`;
          bundle.injuries.push({
            providerInjuryId: String(injuryId),
            league,
            playerProviderId: playerId ? String(playerId) : undefined,
            teamProviderId: teamId,
            status: injury.status ?? injury.type?.description ?? injury.type?.name,
            bodyPart: injury.details?.type ?? injury.bodyPart ?? injury.type,
            detail: injury.details?.detail ?? injury.shortComment ?? injury.longComment ?? injury.description,
            estimatedReturnDate: injury.details?.returnDate ?? injury.returnDate,
            raw: injury
          });
        }
      }
    }

    try {
      const txRoot = await this.siteFetch(league, "transactions") as any;
      const txs = Array.isArray(txRoot?.transactions) ? txRoot.transactions : [];
      for (let i = 0; i < txs.length; i += 1) {
        const tx = txs[i];
        const athlete = tx.athlete ?? tx.player;
        const team = tx.team;
        bundle.transactions.push({
          providerTransactionId: String(tx.id ?? tx.uid ?? `${league}-tx-${tx.date ?? i}-${athlete?.id ?? "na"}`),
          league,
          playerProviderId: athlete?.id ? String(athlete.id) : undefined,
          teamProviderId: team?.id ? String(team.id) : undefined,
          transactionType: tx.type?.description ?? tx.type ?? tx.category,
          detail: tx.description ?? tx.text ?? tx.summary,
          occurredAt: tx.date ?? tx.timestamp,
          raw: tx
        });
      }
    } catch {
      // Transaction coverage is not uniform across every ESPN league endpoint.
    }

    return bundle;
  }
}
