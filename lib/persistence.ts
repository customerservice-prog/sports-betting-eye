import { Pool, PoolClient } from "pg";
import { createInitialPaperState, runExplorationBatch } from "./engine";
import { PaperState } from "./types";

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

    CREATE INDEX IF NOT EXISTS idx_games_starts_at ON games(starts_at);
    CREATE INDEX IF NOT EXISTS idx_predictions_game_id ON predictions(game_id);
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
