import { getDatabasePool } from "./persistence";
import type { League } from "./types";
import type { ESPNPlayer, ESPNTeam } from "./providers/espn-intelligence";

export async function ensureDataLakeSchema() {
  const db = getDatabasePool();
  if (!db) return false;

  await db.query(`
    CREATE TABLE IF NOT EXISTS teams (
      provider TEXT NOT NULL,
      league TEXT NOT NULL,
      provider_team_id TEXT NOT NULL,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      abbreviation TEXT,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(provider, league, provider_team_id)
    );

    CREATE TABLE IF NOT EXISTS players (
      provider TEXT NOT NULL,
      league TEXT NOT NULL,
      provider_player_id TEXT NOT NULL,
      provider_team_id TEXT,
      display_name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      position TEXT,
      jersey TEXT,
      age DOUBLE PRECISION,
      roster_status TEXT,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_roster_seen_at TIMESTAMPTZ,
      profile_updated_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(provider, league, provider_player_id)
    );

    CREATE TABLE IF NOT EXISTS team_snapshots (
      provider TEXT NOT NULL,
      league TEXT NOT NULL,
      provider_team_id TEXT NOT NULL,
      snapshot_type TEXT NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(provider, league, provider_team_id, snapshot_type)
    );

    CREATE TABLE IF NOT EXISTS league_snapshots (
      provider TEXT NOT NULL,
      league TEXT NOT NULL,
      snapshot_type TEXT NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(provider, league, snapshot_type)
    );

    CREATE TABLE IF NOT EXISTS athlete_profiles (
      provider TEXT NOT NULL,
      league TEXT NOT NULL,
      provider_player_id TEXT NOT NULL,
      overview JSONB NOT NULL DEFAULT '{}'::jsonb,
      statistics JSONB NOT NULL DEFAULT '{}'::jsonb,
      captured_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(provider, league, provider_player_id)
    );

    CREATE TABLE IF NOT EXISTS game_packages (
      provider TEXT NOT NULL,
      league TEXT NOT NULL,
      provider_game_id TEXT NOT NULL,
      game_id TEXT REFERENCES games(id) ON DELETE CASCADE,
      game_status TEXT,
      captured_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(provider, league, provider_game_id)
    );

    CREATE TABLE IF NOT EXISTS intelligence_runs (
      id BIGSERIAL PRIMARY KEY,
      run_type TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      teams_updated INTEGER NOT NULL DEFAULT 0,
      players_updated INTEGER NOT NULL DEFAULT 0,
      profiles_updated INTEGER NOT NULL DEFAULT 0,
      game_packages_updated INTEGER NOT NULL DEFAULT 0,
      errors JSONB NOT NULL DEFAULT '[]'::jsonb
    );

    CREATE INDEX IF NOT EXISTS idx_players_team ON players(provider, league, provider_team_id);
    CREATE INDEX IF NOT EXISTS idx_players_profile_updated ON players(profile_updated_at);
    CREATE INDEX IF NOT EXISTS idx_game_packages_captured ON game_packages(captured_at);
  `);

  return true;
}

export async function upsertTeams(provider: string, league: League, teams: ESPNTeam[]) {
  const db = getDatabasePool();
  if (!db) return 0;
  await ensureDataLakeSchema();

  let updated = 0;
  for (const team of teams) {
    await db.query(
      `INSERT INTO teams (
        provider, league, provider_team_id, name, display_name, abbreviation, raw, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
       ON CONFLICT (provider, league, provider_team_id) DO UPDATE SET
        name = EXCLUDED.name,
        display_name = EXCLUDED.display_name,
        abbreviation = EXCLUDED.abbreviation,
        raw = EXCLUDED.raw,
        updated_at = NOW()`,
      [
        provider, league, team.id, team.name, team.displayName, team.abbreviation,
        JSON.stringify(team.raw)
      ]
    );
    updated += 1;
  }
  return updated;
}

export async function upsertRoster(
  provider: string,
  league: League,
  teamId: string,
  players: ESPNPlayer[],
  rawRoster: unknown
) {
  const db = getDatabasePool();
  if (!db) return 0;
  await ensureDataLakeSchema();
  const capturedAt = new Date().toISOString();

  await db.query(
    `INSERT INTO team_snapshots (
       provider, league, provider_team_id, snapshot_type, captured_at, payload, updated_at
     ) VALUES ($1,$2,$3,'roster',$4,$5::jsonb,NOW())
     ON CONFLICT (provider, league, provider_team_id, snapshot_type) DO UPDATE SET
       captured_at = EXCLUDED.captured_at,
       payload = EXCLUDED.payload,
       updated_at = NOW()`,
    [provider, league, teamId, capturedAt, JSON.stringify(rawRoster ?? {})]
  );

  let updated = 0;
  for (const player of players) {
    await db.query(
      `INSERT INTO players (
        provider, league, provider_player_id, provider_team_id,
        display_name, full_name, position, jersey, age, roster_status,
        raw, last_roster_seen_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,NOW())
      ON CONFLICT (provider, league, provider_player_id) DO UPDATE SET
        provider_team_id = EXCLUDED.provider_team_id,
        display_name = EXCLUDED.display_name,
        full_name = EXCLUDED.full_name,
        position = EXCLUDED.position,
        jersey = EXCLUDED.jersey,
        age = EXCLUDED.age,
        roster_status = EXCLUDED.roster_status,
        raw = EXCLUDED.raw,
        last_roster_seen_at = EXCLUDED.last_roster_seen_at,
        updated_at = NOW()`,
      [
        provider, league, player.id, teamId, player.displayName, player.fullName,
        player.position, player.jersey, player.age, player.status,
        JSON.stringify(player.raw), capturedAt
      ]
    );
    updated += 1;
  }
  return updated;
}

export async function saveLeagueSnapshot(
  provider: string,
  league: League,
  snapshotType: string,
  payload: unknown
) {
  const db = getDatabasePool();
  if (!db) return;
  await ensureDataLakeSchema();

  await db.query(
    `INSERT INTO league_snapshots (
      provider, league, snapshot_type, captured_at, payload, updated_at
    ) VALUES ($1,$2,$3,NOW(),$4::jsonb,NOW())
    ON CONFLICT (provider, league, snapshot_type) DO UPDATE SET
      captured_at = NOW(), payload = EXCLUDED.payload, updated_at = NOW()`,
    [provider, league, snapshotType, JSON.stringify(payload ?? {})]
  );
}

export async function saveTeamSnapshot(
  provider: string,
  league: League,
  teamId: string,
  snapshotType: string,
  payload: unknown
) {
  const db = getDatabasePool();
  if (!db) return;
  await ensureDataLakeSchema();

  await db.query(
    `INSERT INTO team_snapshots (
      provider, league, provider_team_id, snapshot_type, captured_at, payload, updated_at
    ) VALUES ($1,$2,$3,$4,NOW(),$5::jsonb,NOW())
    ON CONFLICT (provider, league, provider_team_id, snapshot_type) DO UPDATE SET
      captured_at = NOW(), payload = EXCLUDED.payload, updated_at = NOW()`,
    [provider, league, teamId, snapshotType, JSON.stringify(payload ?? {})]
  );
}

export async function getTeamsForLeague(provider: string, league: League) {
  const db = getDatabasePool();
  if (!db) return [];
  await ensureDataLakeSchema();
  const result = await db.query(
    `SELECT provider_team_id, display_name, abbreviation
     FROM teams
     WHERE provider = $1 AND league = $2
     ORDER BY display_name ASC`,
    [provider, league]
  );
  return result.rows.map((row) => ({
    id: String(row.provider_team_id),
    displayName: String(row.display_name),
    abbreviation: String(row.abbreviation ?? "")
  }));
}

export async function playersNeedingEnrichment(provider: string, limit = 40) {
  const db = getDatabasePool();
  if (!db) return [];
  await ensureDataLakeSchema();
  const result = await db.query(
    `SELECT league, provider_player_id, full_name
     FROM players
     WHERE provider = $1
       AND (
         profile_updated_at IS NULL OR
         profile_updated_at < NOW() - INTERVAL '30 days'
       )
     ORDER BY profile_updated_at NULLS FIRST, updated_at DESC
     LIMIT $2`,
    [provider, Math.max(1, Math.min(250, limit))]
  );
  return result.rows.map((row) => ({
    league: row.league as League,
    playerId: String(row.provider_player_id),
    fullName: String(row.full_name)
  }));
}

export async function saveAthleteProfile(
  provider: string,
  league: League,
  playerId: string,
  overview: unknown,
  statistics: unknown
) {
  const db = getDatabasePool();
  if (!db) return;
  await ensureDataLakeSchema();

  await db.query(
    `INSERT INTO athlete_profiles (
      provider, league, provider_player_id, overview, statistics, captured_at, updated_at
    ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,NOW(),NOW())
    ON CONFLICT (provider, league, provider_player_id) DO UPDATE SET
      overview = EXCLUDED.overview,
      statistics = EXCLUDED.statistics,
      captured_at = NOW(),
      updated_at = NOW()`,
    [provider, league, playerId, JSON.stringify(overview ?? {}), JSON.stringify(statistics ?? {})]
  );

  await db.query(
    `UPDATE players SET profile_updated_at = NOW(), updated_at = NOW()
     WHERE provider = $1 AND league = $2 AND provider_player_id = $3`,
    [provider, league, playerId]
  );
}

export async function gamesNeedingPackages(provider: string, limit = 40) {
  const db = getDatabasePool();
  if (!db) return [];
  await ensureDataLakeSchema();

  const result = await db.query(
    `SELECT g.id, g.league, g.provider_game_id, g.status
     FROM games g
     LEFT JOIN game_packages gp
       ON gp.provider = g.provider
      AND gp.league = g.league
      AND gp.provider_game_id = g.provider_game_id
     WHERE g.provider = $1
       AND g.starts_at >= NOW() - INTERVAL '14 days'
       AND (
         gp.provider_game_id IS NULL OR
         (g.status = 'live' AND gp.captured_at < NOW() - INTERVAL '5 minutes') OR
         (g.status = 'final' AND gp.game_status <> 'final')
       )
     ORDER BY
       CASE g.status WHEN 'live' THEN 0 WHEN 'final' THEN 1 ELSE 2 END,
       g.starts_at DESC
     LIMIT $2`,
    [provider, Math.max(1, Math.min(200, limit))]
  );

  return result.rows.map((row) => ({
    gameId: String(row.id),
    league: row.league as League,
    providerGameId: String(row.provider_game_id),
    status: String(row.status)
  }));
}

export async function saveGamePackage(
  provider: string,
  league: League,
  providerGameId: string,
  gameId: string,
  status: string,
  payload: unknown
) {
  const db = getDatabasePool();
  if (!db) return;
  await ensureDataLakeSchema();

  await db.query(
    `INSERT INTO game_packages (
      provider, league, provider_game_id, game_id, game_status, captured_at, payload, updated_at
    ) VALUES ($1,$2,$3,$4,$5,NOW(),$6::jsonb,NOW())
    ON CONFLICT (provider, league, provider_game_id) DO UPDATE SET
      game_id = EXCLUDED.game_id,
      game_status = EXCLUDED.game_status,
      captured_at = NOW(),
      payload = EXCLUDED.payload,
      updated_at = NOW()`,
    [provider, league, providerGameId, gameId, status, JSON.stringify(payload ?? {})]
  );
}

export async function getDataLakeStats() {
  const db = getDatabasePool();
  if (!db) return {
    configured: false,
    teams: 0,
    players: 0,
    athleteProfiles: 0,
    teamSnapshots: 0,
    leagueSnapshots: 0,
    gamePackages: 0
  };
  await ensureDataLakeSchema();

  const result = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM teams) AS teams,
      (SELECT COUNT(*)::int FROM players) AS players,
      (SELECT COUNT(*)::int FROM athlete_profiles) AS athlete_profiles,
      (SELECT COUNT(*)::int FROM team_snapshots) AS team_snapshots,
      (SELECT COUNT(*)::int FROM league_snapshots) AS league_snapshots,
      (SELECT COUNT(*)::int FROM game_packages) AS game_packages
  `);
  const row = result.rows[0] ?? {};
  return {
    configured: true,
    teams: Number(row.teams ?? 0),
    players: Number(row.players ?? 0),
    athleteProfiles: Number(row.athlete_profiles ?? 0),
    teamSnapshots: Number(row.team_snapshots ?? 0),
    leagueSnapshots: Number(row.league_snapshots ?? 0),
    gamePackages: Number(row.game_packages ?? 0)
  };
}
