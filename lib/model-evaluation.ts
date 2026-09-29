import { getDatabasePool, ensureSchema } from "./persistence";
import { expectedCalibrationError } from "./proof/metrics";

type Row = {
  model_name: string;
  model_version: string;
  league: string;
  home_win_probability: number;
  home_won: boolean;
  brier: number;
  log_loss: number;
  graded_at: Date | string;
};

export async function evaluateRealModels() {
  const db = getDatabasePool();
  if (!db) return { groups: 0, rows: 0 };
  await ensureSchema();

  const result = await db.query<Row>(
    `SELECT
      p.model_name,
      p.model_version,
      g.league,
      p.home_win_probability,
      pg.home_won,
      pg.brier,
      pg.log_loss,
      pg.graded_at
     FROM predictions p
     JOIN prediction_grades pg ON pg.prediction_id = p.id
     JOIN games g ON g.id = p.game_id
     ORDER BY pg.graded_at ASC`
  );

  const groups = new Map<string, Row[]>();
  for (const row of result.rows) {
    const key = `${row.model_name}|${row.model_version}|${row.league}`;
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }

  for (const rows of groups.values()) {
    const first = rows[0];
    const sampleSize = rows.length;
    const brier = rows.reduce((sum, row) => sum + Number(row.brier), 0) / sampleSize;
    const logLoss = rows.reduce((sum, row) => sum + Number(row.log_loss), 0) / sampleSize;
    const accuracy =
      rows.filter((row) => (Number(row.home_win_probability) >= 0.5) === Boolean(row.home_won)).length /
      sampleSize;
    const calibrationError = expectedCalibrationError(
      rows.map((row) => ({
        probability: Number(row.home_win_probability),
        outcome: row.home_won ? 1 : 0
      }))
    );
    const evaluatedThrough = rows[rows.length - 1]?.graded_at ?? null;

    await db.query(
      `INSERT INTO model_backtests (
        model_name, model_version, league, sample_size, brier, log_loss,
        calibration_error, accuracy, evaluated_through, payload, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW())
      ON CONFLICT (model_name, model_version, league) DO UPDATE SET
        sample_size = EXCLUDED.sample_size,
        brier = EXCLUDED.brier,
        log_loss = EXCLUDED.log_loss,
        calibration_error = EXCLUDED.calibration_error,
        accuracy = EXCLUDED.accuracy,
        evaluated_through = EXCLUDED.evaluated_through,
        payload = EXCLUDED.payload,
        updated_at = NOW()`,
      [
        first.model_name,
        first.model_version,
        first.league,
        sampleSize,
        brier,
        logLoss,
        calibrationError,
        accuracy,
        evaluatedThrough,
        JSON.stringify({
          promotionEligible:
            sampleSize >= 200 &&
            brier < 0.25 &&
            calibrationError < 0.08,
          strictProofEligible:
            sampleSize >= 500 &&
            brier < 0.235 &&
            calibrationError < 0.06
        })
      ]
    );
  }

  return { groups: groups.size, rows: result.rows.length };
}

export async function listRealModelPerformance() {
  const db = getDatabasePool();
  if (!db) return [];
  await ensureSchema();

  const result = await db.query(
    `SELECT
      mb.model_name,
      mb.model_version,
      mb.league,
      mb.sample_size,
      mb.brier,
      mb.log_loss,
      mb.calibration_error,
      mb.accuracy,
      mb.evaluated_through,
      mb.payload,
      mr.role
     FROM model_backtests mb
     LEFT JOIN model_registry mr
       ON mr.model_name = mb.model_name
      AND mr.model_version = mb.model_version
     ORDER BY mb.league, mb.brier ASC NULLS LAST`
  );

  return result.rows.map((row) => ({
    modelName: String(row.model_name),
    modelVersion: String(row.model_version),
    league: String(row.league),
    role: String(row.role ?? "challenger"),
    sampleSize: Number(row.sample_size ?? 0),
    brier: row.brier === null ? null : Number(row.brier),
    logLoss: row.log_loss === null ? null : Number(row.log_loss),
    calibrationError: row.calibration_error === null ? null : Number(row.calibration_error),
    accuracy: row.accuracy === null ? null : Number(row.accuracy),
    evaluatedThrough: row.evaluated_through ? new Date(row.evaluated_through).toISOString() : null,
    promotionEligible: Boolean(row.payload?.promotionEligible),
    strictProofEligible: Boolean(row.payload?.strictProofEligible)
  }));
}
