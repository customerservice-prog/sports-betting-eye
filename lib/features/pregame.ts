import { ensureSchema, getDatabasePool } from "../persistence";
import type { League } from "../types";

type SnapshotRow = {
  snapshot_type: string;
  captured_at: string | Date;
  payload: unknown;
};

async function recentTeamGames(team: string, before: string, limit = 12) {
  const db = getDatabasePool();
  if (!db) return [];
  const result = await db.query(
    `SELECT starts_at, home_team, away_team, home_score, away_score
     FROM games
     WHERE status = 'final'
       AND starts_at < $2
       AND (home_team = $1 OR away_team = $1)
       AND home_score IS NOT NULL
       AND away_score IS NOT NULL
     ORDER BY starts_at DESC
     LIMIT $3`,
    [team, before, limit]
  );
  return result.rows.map((row) => {
    const isHome = row.home_team === team;
    const teamScore = Number(isHome ? row.home_score : row.away_score);
    const opponentScore = Number(isHome ? row.away_score : row.home_score);
    return {
      startsAt: new Date(row.starts_at).toISOString(),
      opponent: String(isHome ? row.away_team : row.home_team),
      teamScore,
      opponentScore,
      won: teamScore > opponentScore,
      margin: teamScore - opponentScore
    };
  });
}

function summarizeRecent(games: Awaited<ReturnType<typeof recentTeamGames>>) {
  if (!games.length) {
    return { games: 0, wins: 0, winRate: null, avgMargin: null, avgFor: null, avgAgainst: null };
  }
  const wins = games.filter((game) => game.won).length;
  return {
    games: games.length,
    wins,
    winRate: wins / games.length,
    avgMargin: games.reduce((sum, game) => sum + game.margin, 0) / games.length,
    avgFor: games.reduce((sum, game) => sum + game.teamScore, 0) / games.length,
    avgAgainst: games.reduce((sum, game) => sum + game.opponentScore, 0) / games.length
  };
}

function restDays(games: Awaited<ReturnType<typeof recentTeamGames>>, startsAt: string) {
  if (!games[0]) return null;
  const delta = new Date(startsAt).getTime() - new Date(games[0].startsAt).getTime();
  return Math.max(0, Math.round((delta / 86_400_000) * 10) / 10);
}

async function teamContext(league: League, teamName: string) {
  const db = getDatabasePool();
  if (!db) return null;
  const team = await db.query(
    `SELECT provider_team_id, abbreviation
     FROM teams
     WHERE provider = 'espn-public'
       AND league = $1
       AND display_name = $2
     LIMIT 1`,
    [league, teamName]
  );
  const row = team.rows[0];
  if (!row) return null;

  const snapshots = await db.query<SnapshotRow>(
    `SELECT snapshot_type, captured_at, payload
     FROM team_snapshots
     WHERE provider = 'espn-public'
       AND league = $1
       AND provider_team_id = $2
       AND snapshot_type IN ('injuries', 'statistics', 'depth-chart')`,
    [league, row.provider_team_id]
  );

  return {
    providerTeamId: String(row.provider_team_id),
    abbreviation: String(row.abbreviation ?? ""),
    snapshots: Object.fromEntries(
      snapshots.rows.map((snapshot) => [
        snapshot.snapshot_type,
        {
          capturedAt: new Date(snapshot.captured_at).toISOString(),
          payload: snapshot.payload
        }
      ])
    )
  };
}

async function leagueContext(league: League) {
  const db = getDatabasePool();
  if (!db) return {};
  const result = await db.query<SnapshotRow>(
    `SELECT snapshot_type, captured_at, payload
     FROM league_snapshots
     WHERE provider = 'espn-public'
       AND league = $1
       AND snapshot_type IN ('injuries', 'standings', 'transactions')`,
    [league]
  );
  return Object.fromEntries(
    result.rows.map((snapshot) => [
      snapshot.snapshot_type,
      {
        capturedAt: new Date(snapshot.captured_at).toISOString(),
        payload: snapshot.payload
      }
    ])
  );
}

export async function capturePregameFeatureSnapshot(input: {
  gameId: string;
  league: League;
  startsAt: string;
  homeTeam: string;
  awayTeam: string;
}) {
  const db = getDatabasePool();
  if (!db) return null;
  await ensureSchema();

  const existing = await db.query(
    "SELECT payload FROM feature_snapshots WHERE game_id = $1 AND snapshot_type = 'pregame'",
    [input.gameId]
  );
  if (existing.rows[0]?.payload) return existing.rows[0].payload;

  const [homeRecent, awayRecent, homeContext, awayContext, leagueSnapshots] = await Promise.all([
    recentTeamGames(input.homeTeam, input.startsAt),
    recentTeamGames(input.awayTeam, input.startsAt),
    teamContext(input.league, input.homeTeam),
    teamContext(input.league, input.awayTeam),
    leagueContext(input.league)
  ]);

  const capturedAt = new Date().toISOString();
  const payload = {
    capturedAt,
    gameStartsAt: input.startsAt,
    league: input.league,
    home: {
      team: input.homeTeam,
      recent: summarizeRecent(homeRecent),
      restDays: restDays(homeRecent, input.startsAt),
      context: homeContext
    },
    away: {
      team: input.awayTeam,
      recent: summarizeRecent(awayRecent),
      restDays: restDays(awayRecent, input.startsAt),
      context: awayContext
    },
    leagueContext: leagueSnapshots,
    missing: {
      homeTeamContext: !homeContext,
      awayTeamContext: !awayContext,
      leagueInjuries: !(leagueSnapshots as any).injuries,
      standings: !(leagueSnapshots as any).standings
    }
  };

  await db.query(
    `INSERT INTO feature_snapshots (game_id, snapshot_type, captured_at, payload)
     VALUES ($1,'pregame',$2,$3::jsonb)
     ON CONFLICT (game_id, snapshot_type) DO NOTHING`,
    [input.gameId, capturedAt, JSON.stringify(payload)]
  );

  return payload;
}
