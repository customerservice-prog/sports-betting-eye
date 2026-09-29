import { Pool, PoolClient } from "pg";
import { createInitialPaperState, runExplorationBatch } from "./engine";
import { PaperState } from "./types";
import { applyEloResult, predictEloGame, type EloState } from "./modeling/elo";
import { applyCompletedGame, createLeagueModelState, predictRealModels } from "./modeling/challengers";
import { capturePregameFeatureSnapshot } from "./features/pregame";

declare global {
  // eslint-disable-next-line no-var
  var __sportsEyePool: Pool | undefined;
}

function pool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  if (!global.__sportsEyePool) {
    global.__sportsEyePool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });
  }

  return global.__sportsEyePool;
}

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getDatabasePool() {
  return pool();
}

export async function ensureSchema(client?: PoolClient) {
  const target = client ?? pool();
  if (!target) return false;

  await target.query(`
    CREATE TABLE IF NOT EXISTS sports_eye_state (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS exploration_batches (
      id BIGSERIAL PRIMARY KEY,
      batch_size INTEGER NOT NULL,
      previous_bankroll NUMERIC NOT NULL,
      resulting_bankroll NUMERIC NOT NULL,
      wins_added INTEGER NOT NULL,
      losses_added INTEGER NOT NULL,
      brier DOUBLE PRECISION NOT NULL,
      calibration_error DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_game_id TEXT NOT NULL,
      league TEXT NOT NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      home_score INTEGER,
      away_score INTEGER,
      source_updated_at TIMESTAMPTZ NOT NULL,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE(provider, provider_game_id)
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id BIGSERIAL PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      model_name TEXT NOT NULL,
      model_version TEXT NOT NULL,
      as_of TIMESTAMPTZ NOT NULL,
      home_win_probability DOUBLE PRECISION NOT NULL CHECK (home_win_probability >= 0 AND home_win_probability <= 1),
      predicted_home_score DOUBLE PRECISION,
      predicted_away_score DOUBLE PRECISION,
      uncertainty DOUBLE PRECISION,
      pick_status TEXT NOT NULL DEFAULT 'NO PICK',
      features JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(game_id, model_name, model_version, as_of)
    );

    CREATE TABLE IF NOT EXISTS prediction_grades (
      id BIGSERIAL PRIMARY KEY,
      prediction_id BIGINT NOT NULL UNIQUE REFERENCES predictions(id) ON DELETE CASCADE,
      home_won BOOLEAN NOT NULL,
      brier DOUBLE PRECISION NOT NULL,
      log_loss DOUBLE PRECISION NOT NULL,
      margin_error DOUBLE PRECISION,
      graded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS mistake_cases (
      id BIGSERIAL PRIMARY KEY,
      prediction_id BIGINT REFERENCES predictions(id) ON DELETE SET NULL,
      severity TEXT NOT NULL,
      root_cause TEXT,
      lesson TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS feature_snapshots (
      id BIGSERIAL PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      snapshot_type TEXT NOT NULL DEFAULT 'pregame',
      captured_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(game_id, snapshot_type)
    );

    CREATE TABLE IF NOT EXISTS model_backtests (
      model_name TEXT NOT NULL,
      model_version TEXT NOT NULL,
      league TEXT NOT NULL,
      sample_size INTEGER NOT NULL DEFAULT 0,
      brier DOUBLE PRECISION,
      log_loss DOUBLE PRECISION,
      calibration_error DOUBLE PRECISION,
      accuracy DOUBLE PRECISION,
      evaluated_through TIMESTAMPTZ,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(model_name, model_version, league)
    );

    CREATE TABLE IF NOT EXISTS model_registry (
      model_name TEXT NOT NULL,
      model_version TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'challenger',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      promoted_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(model_name, model_version)
    );

    INSERT INTO model_registry (model_name, model_version, role)
    VALUES
      ('elo-real-games', 'v1', 'baseline'),
      ('recent-form', 'v1', 'challenger'),
      ('sports-ensemble', 'v1', 'challenger')
    ON CONFLICT (model_name, model_version) DO NOTHING;

    CREATE INDEX IF NOT EXISTS idx_games_starts_at ON games(starts_at);
    CREATE INDEX IF NOT EXISTS idx_predictions_game_id ON predictions(game_id);
    CREATE INDEX IF NOT EXISTS idx_feature_snapshots_game_id ON feature_snapshots(game_id);
    CREATE INDEX IF NOT EXISTS idx_model_backtests_model ON model_backtests(model_name, model_version);
    CREATE INDEX IF NOT EXISTS idx_exploration_batches_created_at ON exploration_batches(created_at);
  `);

  return true;
}

export async function getPaperState(): Promise<PaperState | null> {
  const db = pool();
  if (!db) return null;
  await ensureSchema();
  const result = await db.query<{ payload: PaperState }>(
    "SELECT payload FROM sports_eye_state WHERE id = $1",
    ["paper"]
  );
  return result.rows[0]?.payload ?? null;
}

export async function resetPaperStatePersistent(): Promise<PaperState> {
  const db = pool();
  const initial = createInitialPaperState();
  if (!db) return initial;

  await ensureSchema();
  await db.query(
    `INSERT INTO sports_eye_state (id, payload, updated_at)
     VALUES ('paper', $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    [JSON.stringify(initial)]
  );
  return initial;
}

export async function runPersistentExplorationBatch(batchSize: number): Promise<PaperState> {
  const db = pool();
  const safeBatchSize = Math.max(1, Math.min(100_000, Math.floor(batchSize)));

  if (!db) {
    return runExplorationBatch(createInitialPaperState(), safeBatchSize);
  }

  await ensureSchema();
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const initial = createInitialPaperState();

    await client.query(
      `INSERT INTO sports_eye_state (id, payload, updated_at)
       VALUES ('paper', $1::jsonb, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(initial)]
    );

    const locked = await client.query<{ payload: PaperState }>(
      "SELECT payload FROM sports_eye_state WHERE id = 'paper' FOR UPDATE"
    );

    const current = locked.rows[0]?.payload ?? initial;
    const next = runExplorationBatch(current, safeBatchSize);

    await client.query(
      "UPDATE sports_eye_state SET payload = $1::jsonb, updated_at = NOW() WHERE id = 'paper'",
      [JSON.stringify(next)]
    );

    await client.query(
      `INSERT INTO exploration_batches (
        batch_size, previous_bankroll, resulting_bankroll,
        wins_added, losses_added, brier, calibration_error
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        safeBatchSize,
        current.explorationBankroll,
        next.explorationBankroll,
        next.wins - current.wins,
        next.losses - current.losses,
        next.brier,
        next.calibrationError
      ]
    );

    await client.query("COMMIT");
    return next;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getSystemStats() {
  const db = pool();
  if (!db) {
    return {
      configured: false,
      reachable: false,
      counts: { games: 0, predictions: 0, grades: 0, mistakes: 0, explorationBatches: 0 },
      paper: null as PaperState | null
    };
  }

  await ensureSchema();

  const [counts, paper] = await Promise.all([
    db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM games) AS games,
        (SELECT COUNT(*)::int FROM predictions) AS predictions,
        (SELECT COUNT(*)::int FROM prediction_grades) AS grades,
        (SELECT COUNT(*)::int FROM mistake_cases) AS mistakes,
        (SELECT COUNT(*)::int FROM exploration_batches) AS exploration_batches
    `),
    getPaperState()
  ]);

  const row = counts.rows[0] ?? {};

  return {
    configured: true,
    reachable: true,
    counts: {
      games: Number(row.games ?? 0),
      predictions: Number(row.predictions ?? 0),
      grades: Number(row.grades ?? 0),
      mistakes: Number(row.mistakes ?? 0),
      explorationBatches: Number(row.exploration_batches ?? 0)
    },
    paper
  };
}

export type FeedGame = {
  providerGameId: string;
  league: string;
  startsAt: string;
  homeTeam: string;
  awayTeam: string;
  status: "scheduled" | "live" | "final";
  homeScore?: number;
  awayScore?: number;
  sourceUpdatedAt: string;
  homeAbbreviation?: string;
  awayAbbreviation?: string;
  homeRecord?: string;
  awayRecord?: string;
  venue?: string;
  statusDetail?: string;
  raw?: Record<string, unknown>;
};

export async function upsertProviderGames(provider: string, games: FeedGame[]) {
  const db = pool();
  if (!db) return 0;
  await ensureSchema();

  let count = 0;
  for (const game of games) {
    const id = `${provider}:${game.league}:${game.providerGameId}`;
    const raw = {
      ...(game.raw ?? {}),
      homeAbbreviation: game.homeAbbreviation ?? "",
      awayAbbreviation: game.awayAbbreviation ?? "",
      homeRecord: game.homeRecord ?? "",
      awayRecord: game.awayRecord ?? "",
      venue: game.venue ?? "",
      statusDetail: game.statusDetail ?? ""
    };

    await db.query(
      `INSERT INTO games (
        id, provider, provider_game_id, league, starts_at, home_team, away_team,
        status, home_score, away_score, source_updated_at, raw
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
      ON CONFLICT (provider, provider_game_id) DO UPDATE SET
        league = EXCLUDED.league,
        starts_at = EXCLUDED.starts_at,
        home_team = EXCLUDED.home_team,
        away_team = EXCLUDED.away_team,
        status = EXCLUDED.status,
        home_score = EXCLUDED.home_score,
        away_score = EXCLUDED.away_score,
        source_updated_at = EXCLUDED.source_updated_at,
        raw = EXCLUDED.raw`,
      [
        id, provider, game.providerGameId, game.league, game.startsAt,
        game.homeTeam, game.awayTeam, game.status,
        game.homeScore ?? null, game.awayScore ?? null,
        game.sourceUpdatedAt, JSON.stringify(raw)
      ]
    );
    count += 1;
  }
  return count;
}

export async function listLiveGames(input?: { pastHours?: number; futureHours?: number; limit?: number }) {
  const db = pool();
  if (!db) return [];
  await ensureSchema();

  const pastHours = Math.max(1, Math.min(168, input?.pastHours ?? 18));
  const futureHours = Math.max(1, Math.min(336, input?.futureHours ?? 120));
  const limit = Math.max(1, Math.min(250, input?.limit ?? 100));

  const result = await db.query(
    `SELECT id, provider, provider_game_id, league, starts_at, home_team, away_team,
      status, home_score, away_score, source_updated_at, raw
     FROM games
     WHERE starts_at >= NOW() - ($1 * INTERVAL '1 hour')
       AND starts_at <= NOW() + ($2 * INTERVAL '1 hour')
     ORDER BY
       CASE status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
       starts_at ASC
     LIMIT $3`,
    [pastHours, futureHours, limit]
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    provider: row.provider,
    providerGameId: row.provider_game_id,
    league: row.league,
    startsAt: new Date(row.starts_at).toISOString(),
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    homeAbbreviation: row.raw?.homeAbbreviation ?? row.home_team.slice(0, 3).toUpperCase(),
    awayAbbreviation: row.raw?.awayAbbreviation ?? row.away_team.slice(0, 3).toUpperCase(),
    homeRecord: row.raw?.homeRecord ?? "",
    awayRecord: row.raw?.awayRecord ?? "",
    venue: row.raw?.venue ?? "",
    status: row.status,
    statusDetail: row.raw?.statusDetail ?? "",
    homeScore: row.home_score === null ? null : Number(row.home_score),
    awayScore: row.away_score === null ? null : Number(row.away_score),
    sourceUpdatedAt: new Date(row.source_updated_at).toISOString()
  }));
}

export type HistoricalBackfillState = {
  cursorEnd: string;
  targetStart: string;
  complete: boolean;
  chunksCompleted: number;
  gamesStored: number;
  updatedAt: string;
};

export async function getHistoricalBackfillState(): Promise<HistoricalBackfillState | null> {
  const db = pool();
  if (!db) return null;
  await ensureSchema();
  const result = await db.query<{ payload: HistoricalBackfillState }>(
    "SELECT payload FROM sports_eye_state WHERE id = $1",
    ["historical_backfill"]
  );
  return result.rows[0]?.payload ?? null;
}

export async function saveHistoricalBackfillState(state: HistoricalBackfillState) {
  const db = pool();
  if (!db) return;
  await ensureSchema();
  await db.query(
    `INSERT INTO sports_eye_state (id, payload, updated_at)
     VALUES ('historical_backfill', $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    [JSON.stringify(state)]
  );
}

async function eloStateByLeague() {
  const db = pool();
  const empty = new Map<string, { state: EloState; sampleSize: number }>();
  if (!db) return empty;
  await ensureSchema();

  const result = await db.query(
    `SELECT league, home_team, away_team, home_score, away_score, starts_at
     FROM games
     WHERE status = 'final'
       AND home_score IS NOT NULL
       AND away_score IS NOT NULL
       AND starts_at < NOW()
     ORDER BY starts_at ASC`
  );

  const byLeague = empty;
  for (const row of result.rows) {
    const current = byLeague.get(row.league) ?? { state: {}, sampleSize: 0 };
    current.state = applyEloResult(current.state, {
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      homeWon: Number(row.home_score) > Number(row.away_score)
    });
    current.sampleSize += 1;
    byLeague.set(row.league, current);
  }
  return byLeague;
}

export async function listLiveGamesWithBaseline(input?: { pastHours?: number; futureHours?: number; limit?: number }) {
  const games = await listLiveGames(input);
  const [elo, backfill] = await Promise.all([eloStateByLeague(), getHistoricalBackfillState()]);

  return games.map((game: any) => {
    if (game.status !== "scheduled" || new Date(game.startsAt).getTime() <= Date.now()) {
      return { ...game, baseline: null };
    }

    const league = elo.get(game.league);
    if (!league || league.sampleSize < 10) {
      return { ...game, baseline: null };
    }

    const prediction = predictEloGame(league.state, game.homeTeam, game.awayTeam);
    return {
      ...game,
      baseline: {
        model: "Elo real-games baseline",
        homeWin: Math.round(prediction.homeWinProbability * 1000) / 10,
        awayWin: Math.round((1 - prediction.homeWinProbability) * 1000) / 10,
        sampleSize: league.sampleSize,
        historyComplete: Boolean(backfill?.complete)
      }
    };
  });
}


async function liveModelStatesByLeague() {
  const db = pool();
  const states = new Map<string, ReturnType<typeof createLeagueModelState>>();
  if (!db) return states;
  await ensureSchema();

  const result = await db.query(
    `SELECT id, league, starts_at, home_team, away_team, home_score, away_score
     FROM games
     WHERE status = 'final'
       AND home_score IS NOT NULL
       AND away_score IS NOT NULL
       AND starts_at < NOW()
     ORDER BY starts_at ASC`
  );

  for (const row of result.rows) {
    const state = states.get(row.league) ?? createLeagueModelState();
    applyCompletedGame(state, {
      id: String(row.id),
      league: String(row.league),
      startsAt: new Date(row.starts_at).toISOString(),
      homeTeam: String(row.home_team),
      awayTeam: String(row.away_team),
      homeScore: Number(row.home_score),
      awayScore: Number(row.away_score)
    });
    states.set(row.league, state);
  }
  return states;
}

export async function generateScheduledBaselinePredictions(limit = 250) {
  const db = pool();
  if (!db) return { created: 0, skipped: 0, snapshotsCreated: 0, byModel: {} as Record<string, number> };
  await ensureSchema();

  const states = await liveModelStatesByLeague();
  const games = await db.query(
    `SELECT id, league, starts_at, home_team, away_team
     FROM games
     WHERE status = 'scheduled'
       AND starts_at > NOW()
       AND starts_at <= NOW() + INTERVAL '7 days'
     ORDER BY starts_at ASC
     LIMIT $1`,
    [Math.max(1, Math.min(1000, limit))]
  );

  let created = 0;
  let skipped = 0;
  let snapshotsCreated = 0;
  const byModel: Record<string, number> = {};

  for (const row of games.rows) {
    const state = states.get(row.league);
    if (!state || state.completedGames < 10) {
      skipped += 1;
      continue;
    }

    const existingSnapshot = await db.query(
      "SELECT 1 FROM feature_snapshots WHERE game_id = $1 AND snapshot_type = 'pregame'",
      [row.id]
    );
    const snapshot = await capturePregameFeatureSnapshot({
      gameId: String(row.id),
      league: row.league,
      startsAt: new Date(row.starts_at).toISOString(),
      homeTeam: String(row.home_team),
      awayTeam: String(row.away_team)
    });
    if (!existingSnapshot.rowCount && snapshot) snapshotsCreated += 1;

    const models = predictRealModels(state, String(row.home_team), String(row.away_team));
    for (const model of models) {
      const already = await db.query(
        `SELECT id FROM predictions
         WHERE game_id = $1 AND model_name = $2 AND model_version = $3
         LIMIT 1`,
        [row.id, model.modelName, model.version]
      );
      if (already.rowCount) {
        skipped += 1;
        continue;
      }

      const probability = model.homeWinProbability;
      const confidence = Math.abs(probability - 0.5);
      const pickStatus =
        model.modelName === "sports-ensemble" && confidence >= 0.16
          ? "PROOF PICK"
          : confidence >= 0.08
            ? "EXPERIMENT"
            : "NO PICK";

      const result = await db.query(
        `INSERT INTO predictions (
          game_id, model_name, model_version, as_of,
          home_win_probability, predicted_home_score, predicted_away_score,
          uncertainty, pick_status, features
        )
        VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8,$9::jsonb)
        RETURNING id`,
        [
          row.id,
          model.modelName,
          model.version,
          probability,
          model.predictedHomeScore,
          model.predictedAwayScore,
          model.uncertainty,
          pickStatus,
          JSON.stringify({
            ...model.features,
            featureSnapshotCaptured: Boolean(snapshot),
            generatedFrom: "real completed game history"
          })
        ]
      );

      if (result.rowCount) {
        created += 1;
        byModel[model.modelName] = (byModel[model.modelName] ?? 0) + 1;
      }
    }
  }

  return { created, skipped, snapshotsCreated, byModel };
}

export async function gradeCompletedPredictions(limit = 500) {
  const db = pool();
  if (!db) return { graded: 0, mistakesCreated: 0 };
  await ensureSchema();

  const rows = await db.query(
    `SELECT
       p.id AS prediction_id,
       p.home_win_probability,
       p.pick_status,
       g.home_score,
       g.away_score
     FROM predictions p
     JOIN games g ON g.id = p.game_id
     LEFT JOIN prediction_grades pg ON pg.prediction_id = p.id
     WHERE pg.id IS NULL
       AND g.status = 'final'
       AND g.home_score IS NOT NULL
       AND g.away_score IS NOT NULL
     ORDER BY g.starts_at ASC
     LIMIT $1`,
    [Math.max(1, Math.min(5000, limit))]
  );

  let graded = 0;
  let mistakesCreated = 0;

  for (const row of rows.rows) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, Number(row.home_win_probability)));
    const homeWon = Number(row.home_score) > Number(row.away_score);
    const outcome = homeWon ? 1 : 0;
    const brier = Math.pow(p - outcome, 2);
    const logLoss = -(outcome * Math.log(p) + (1 - outcome) * Math.log(1 - p));

    await db.query(
      `INSERT INTO prediction_grades (prediction_id, home_won, brier, log_loss)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (prediction_id) DO NOTHING`,
      [row.prediction_id, homeWon, brier, logLoss]
    );
    graded += 1;

    const predictedHome = p >= 0.5;
    const wasWrong = predictedHome !== homeWon;
    const confidence = Math.max(p, 1 - p);

    if (wasWrong && confidence >= 0.65) {
      const severity = confidence >= 0.8 ? "Critical" : confidence >= 0.7 ? "High" : "Medium";
      const inserted = await db.query(
        `INSERT INTO mistake_cases (prediction_id, severity, root_cause, lesson, tags)
         SELECT $1,$2,$3,$4,$5::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM mistake_cases WHERE prediction_id = $1)
         RETURNING id`,
        [
          row.prediction_id,
          severity,
          "High-confidence baseline prediction missed the final outcome; deeper feature attribution required.",
          "Replay this game during challenger training and inspect injuries, matchup context, rest, and market disagreement.",
          JSON.stringify(["high-confidence", "wrong-pick", "auto-generated"])
        ]
      );
      if (inserted.rowCount) mistakesCreated += 1;
    }
  }

  return { graded, mistakesCreated };
}


export type TeamRecordInput = {
  providerTeamId: string;
  league: string;
  name: string;
  abbreviation?: string;
  location?: string;
  raw?: Record<string, unknown>;
};

export type PlayerRecordInput = {
  providerPlayerId: string;
  league: string;
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
};

export type InjuryRecordInput = {
  providerInjuryId: string;
  league: string;
  playerProviderId?: string;
  teamProviderId?: string;
  status?: string;
  bodyPart?: string;
  detail?: string;
  estimatedReturnDate?: string;
  raw?: Record<string, unknown>;
};

export type TransactionRecordInput = {
  providerTransactionId: string;
  league: string;
  playerProviderId?: string;
  teamProviderId?: string;
  transactionType?: string;
  detail?: string;
  occurredAt?: string;
  raw?: Record<string, unknown>;
};

function providerEntityId(provider: string, league: string, kind: string, providerId: string) {
  return `${provider}:${league}:${kind}:${providerId}`;
}

export async function upsertReferenceData(
  provider: string,
  input: {
    teams?: TeamRecordInput[];
    players?: PlayerRecordInput[];
    injuries?: InjuryRecordInput[];
    transactions?: TransactionRecordInput[];
    capturedAt?: string;
  }
) {
  const db = pool();
  if (!db) return { teams: 0, players: 0, injuries: 0, transactions: 0 };
  await ensureSchema();
  const capturedAt = input.capturedAt ?? new Date().toISOString();

  let teamCount = 0;
  let playerCount = 0;
  let injuryCount = 0;
  let transactionCount = 0;

  for (const team of input.teams ?? []) {
    const id = providerEntityId(provider, team.league, "team", team.providerTeamId);
    await db.query(
      `INSERT INTO teams (id, provider, provider_team_id, league, name, abbreviation, location, raw, source_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       ON CONFLICT (provider, provider_team_id, league) DO UPDATE SET
         name=EXCLUDED.name, abbreviation=EXCLUDED.abbreviation, location=EXCLUDED.location,
         raw=EXCLUDED.raw, source_updated_at=EXCLUDED.source_updated_at`,
      [id, provider, team.providerTeamId, team.league, team.name, team.abbreviation ?? null,
       team.location ?? null, JSON.stringify(team.raw ?? {}), capturedAt]
    );
    teamCount += 1;
  }

  for (const player of input.players ?? []) {
    const id = providerEntityId(provider, player.league, "player", player.providerPlayerId);
    await db.query(
      `INSERT INTO players (
        id, provider, provider_player_id, league, full_name, first_name, last_name, position,
        jersey, height, weight, age, experience, active, raw, source_updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
      ON CONFLICT (provider, provider_player_id, league) DO UPDATE SET
        full_name=EXCLUDED.full_name, first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
        position=EXCLUDED.position, jersey=EXCLUDED.jersey, height=EXCLUDED.height,
        weight=EXCLUDED.weight, age=EXCLUDED.age, experience=EXCLUDED.experience,
        active=EXCLUDED.active, raw=EXCLUDED.raw, source_updated_at=EXCLUDED.source_updated_at`,
      [id, provider, player.providerPlayerId, player.league, player.fullName, player.firstName ?? null,
       player.lastName ?? null, player.position ?? null, player.jersey ?? null, player.height ?? null,
       player.weight ?? null, player.age ?? null, player.experience ?? null, player.active ?? null,
       JSON.stringify(player.raw ?? {}), capturedAt]
    );

    if (player.teamProviderId) {
      const teamId = providerEntityId(provider, player.league, "team", player.teamProviderId);
      await db.query(
        `INSERT INTO roster_snapshots (
          team_id, player_id, league, captured_at, starter, depth_order, roster_status, raw
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [teamId, id, player.league, capturedAt, player.starter ?? null, player.depthOrder ?? null,
         player.rosterStatus ?? null, JSON.stringify(player.raw ?? {})]
      ).catch(() => undefined);
    }
    playerCount += 1;
  }

  for (const injury of input.injuries ?? []) {
    const id = providerEntityId(provider, injury.league, "injury", injury.providerInjuryId);
    const playerId = injury.playerProviderId
      ? providerEntityId(provider, injury.league, "player", injury.playerProviderId) : null;
    const teamId = injury.teamProviderId
      ? providerEntityId(provider, injury.league, "team", injury.teamProviderId) : null;
    await db.query(
      `INSERT INTO injuries (
        id, provider, league, player_id, team_id, status, body_part, detail,
        estimated_return_date, captured_at, raw
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        status=EXCLUDED.status, body_part=EXCLUDED.body_part, detail=EXCLUDED.detail,
        estimated_return_date=EXCLUDED.estimated_return_date, captured_at=EXCLUDED.captured_at,
        raw=EXCLUDED.raw`,
      [id, provider, injury.league, playerId, teamId, injury.status ?? null, injury.bodyPart ?? null,
       injury.detail ?? null, injury.estimatedReturnDate ?? null, capturedAt, JSON.stringify(injury.raw ?? {})]
    );
    injuryCount += 1;
  }

  for (const transaction of input.transactions ?? []) {
    const id = providerEntityId(provider, transaction.league, "transaction", transaction.providerTransactionId);
    const playerId = transaction.playerProviderId
      ? providerEntityId(provider, transaction.league, "player", transaction.playerProviderId) : null;
    const teamId = transaction.teamProviderId
      ? providerEntityId(provider, transaction.league, "team", transaction.teamProviderId) : null;
    await db.query(
      `INSERT INTO transactions (
        id, provider, league, team_id, player_id, transaction_type, detail, occurred_at, captured_at, raw
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        transaction_type=EXCLUDED.transaction_type, detail=EXCLUDED.detail,
        occurred_at=EXCLUDED.occurred_at, captured_at=EXCLUDED.captured_at, raw=EXCLUDED.raw`,
      [id, provider, transaction.league, teamId, playerId, transaction.transactionType ?? null,
       transaction.detail ?? null, transaction.occurredAt ?? null, capturedAt, JSON.stringify(transaction.raw ?? {})]
    );
    transactionCount += 1;
  }

  return { teams: teamCount, players: playerCount, injuries: injuryCount, transactions: transactionCount };
}

export async function getKnowledgeCounts() {
  const db = pool();
  if (!db) return { teams: 0, players: 0, rosterSnapshots: 0, injuries: 0, transactions: 0, contextSnapshots: 0 };
  await ensureSchema();
  const result = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM teams) AS teams,
      (SELECT COUNT(*)::int FROM players) AS players,
      (SELECT COUNT(*)::int FROM roster_snapshots) AS roster_snapshots,
      (SELECT COUNT(*)::int FROM injuries) AS injuries,
      (SELECT COUNT(*)::int FROM transactions) AS transactions,
      (SELECT COUNT(*)::int FROM game_context_snapshots) AS context_snapshots
  `);
  const row = result.rows[0] ?? {};
  return {
    teams: Number(row.teams ?? 0),
    players: Number(row.players ?? 0),
    rosterSnapshots: Number(row.roster_snapshots ?? 0),
    injuries: Number(row.injuries ?? 0),
    transactions: Number(row.transactions ?? 0),
    contextSnapshots: Number(row.context_snapshots ?? 0)
  };
}


export async function getNamedState<T = any>(id: string): Promise<T | null> {
  const db = pool();
  if (!db) return null;
  await ensureSchema();
  const result = await db.query<{ payload: T }>(
    "SELECT payload FROM sports_eye_state WHERE id = $1",
    [id]
  );
  return result.rows[0]?.payload ?? null;
}

export async function saveNamedState(id: string, payload: unknown) {
  const db = pool();
  if (!db) return;
  await ensureSchema();
  await db.query(
    `INSERT INTO sports_eye_state (id, payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    [id, JSON.stringify(payload)]
  );
}
