import { ESPNIntelligenceProvider, intelligenceLeagues } from "./providers/espn-intelligence";
import {
  ensureDataLakeSchema,
  gamesNeedingPackages,
  leagueSnapshotDue,
  playersNeedingEnrichment,
  saveAthleteProfile,
  saveGamePackage,
  saveLeagueSnapshot,
  saveTeamSnapshot,
  teamsNeedingRefresh,
  upsertRoster,
  upsertTeams
} from "./data-lake";
import { getDatabasePool } from "./persistence";

type IntelligenceError = {
  scope: string;
  message: string;
};

export type IntelligenceRunResult = {
  teamsUpdated: number;
  playersUpdated: number;
  profilesUpdated: number;
  gamePackagesUpdated: number;
  leagueSnapshotsUpdated: number;
  teamSnapshotsUpdated: number;
  errors: IntelligenceError[];
  completedAt: string;
};

function message(error: unknown) {
  return error instanceof Error ? error.message : "Unknown intelligence ingestion error";
}

async function recordRun(startedAt: string, result: IntelligenceRunResult) {
  const db = getDatabasePool();
  if (!db) return;
  await ensureDataLakeSchema();
  await db.query(
    `INSERT INTO intelligence_runs (
      run_type, started_at, completed_at, teams_updated, players_updated,
      profiles_updated, game_packages_updated, errors
    ) VALUES ('incremental',$1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      startedAt,
      result.completedAt,
      result.teamsUpdated,
      result.playersUpdated,
      result.profilesUpdated,
      result.gamePackagesUpdated,
      JSON.stringify(result.errors)
    ]
  );
}

export async function ingestSportsIntelligence(): Promise<IntelligenceRunResult> {
  const startedAt = new Date().toISOString();
  const provider = new ESPNIntelligenceProvider();
  const errors: IntelligenceError[] = [];
  let teamsUpdated = 0;
  let playersUpdated = 0;
  let profilesUpdated = 0;
  let gamePackagesUpdated = 0;
  let leagueSnapshotsUpdated = 0;
  let teamSnapshotsUpdated = 0;

  await ensureDataLakeSchema();

  // Team directories are cheap and keep IDs/names current for every supported league.
  const teamResults = await Promise.all(
    intelligenceLeagues.map(async (league) => {
      try {
        const teams = await provider.getTeams(league);
        const stored = await upsertTeams(provider.name, league, teams);
        return { league, stored, error: "" };
      } catch (error) {
        return { league, stored: 0, error: message(error) };
      }
    })
  );

  for (const item of teamResults) {
    teamsUpdated += item.stored;
    if (item.error) errors.push({ scope: `${item.league}:teams`, message: item.error });
  }

  // League-wide context refreshes on its own cadence rather than every five-minute worker run.
  for (const league of intelligenceLeagues) {
    const leagueJobs: Array<{
      type: string;
      dueMinutes: number;
      fetcher: () => Promise<unknown>;
    }> = [
      { type: "injuries", dueMinutes: 30, fetcher: () => provider.getLeagueInjuries(league) },
      { type: "standings", dueMinutes: 180, fetcher: () => provider.getStandings(league) },
      { type: "transactions", dueMinutes: 60, fetcher: () => provider.getTransactions(league) }
    ];

    for (const job of leagueJobs) {
      try {
        if (!(await leagueSnapshotDue(provider.name, league, job.type, job.dueMinutes))) continue;
        const payload = await job.fetcher();
        await saveLeagueSnapshot(provider.name, league, job.type, payload);
        leagueSnapshotsUpdated += 1;
      } catch (error) {
        errors.push({ scope: `${league}:${job.type}`, message: message(error) });
      }
    }
  }

  // Rotate through stale team profiles. This eventually covers every team without hammering the source.
  const teamLimit = Math.max(1, Number(process.env.INTELLIGENCE_TEAMS_PER_RUN || 8));
  const staleHours = Math.max(1, Number(process.env.INTELLIGENCE_TEAM_STALE_HOURS || 12));
  const staleTeams = await teamsNeedingRefresh(provider.name, teamLimit, staleHours);

  for (const team of staleTeams) {
    try {
      const roster = await provider.getRoster(team.league, team.teamId);
      playersUpdated += await upsertRoster(
        provider.name,
        team.league,
        team.teamId,
        roster.players,
        roster.raw
      );
      teamSnapshotsUpdated += 1;
    } catch (error) {
      errors.push({ scope: `${team.league}:${team.displayName}:roster`, message: message(error) });
    }

    const optional = [
      {
        type: "statistics",
        run: () => provider.getTeamStatistics(team.league, team.teamId)
      },
      {
        type: "depth-chart",
        run: () => provider.getTeamDepthChart(team.league, team.teamId)
      },
      {
        type: "injuries",
        run: () => provider.getTeamInjuries(team.league, team.abbreviation || team.teamId)
      }
    ];

    for (const job of optional) {
      try {
        const payload = await job.run();
        await saveTeamSnapshot(provider.name, team.league, team.teamId, job.type, payload);
        teamSnapshotsUpdated += 1;
      } catch (error) {
        errors.push({
          scope: `${team.league}:${team.displayName}:${job.type}`,
          message: message(error)
        });
      }
    }
  }

  // Enrich a bounded queue of players every run; over time every rostered player gets overview + stats.
  const playerLimit = Math.max(1, Number(process.env.INTELLIGENCE_PLAYERS_PER_RUN || 12));
  const players = await playersNeedingEnrichment(provider.name, playerLimit);
  for (const player of players) {
    try {
      const [overview, statistics] = await Promise.all([
        provider.getAthleteOverview(player.league, player.playerId).catch(() => ({})),
        provider.getAthleteStats(player.league, player.playerId).catch(() => ({}))
      ]);
      await saveAthleteProfile(
        provider.name,
        player.league,
        player.playerId,
        overview,
        statistics
      );
      profilesUpdated += 1;
    } catch (error) {
      errors.push({ scope: `${player.league}:player:${player.fullName}`, message: message(error) });
    }
  }

  // Store box score / play / leader packages for live and recently completed games.
  const packageLimit = Math.max(1, Number(process.env.INTELLIGENCE_GAME_PACKAGES_PER_RUN || 20));
  const games = await gamesNeedingPackages(provider.name, packageLimit);
  for (const game of games) {
    try {
      const payload = await provider.getGameSummary(game.league, game.providerGameId);
      await saveGamePackage(
        provider.name,
        game.league,
        game.providerGameId,
        game.gameId,
        game.status,
        payload
      );
      gamePackagesUpdated += 1;
    } catch (error) {
      errors.push({
        scope: `${game.league}:game:${game.providerGameId}:summary`,
        message: message(error)
      });
    }
  }

  const result: IntelligenceRunResult = {
    teamsUpdated,
    playersUpdated,
    profilesUpdated,
    gamePackagesUpdated,
    leagueSnapshotsUpdated,
    teamSnapshotsUpdated,
    errors,
    completedAt: new Date().toISOString()
  };
  await recordRun(startedAt, result).catch(() => undefined);
  return result;
}
