import { brierScore, expectedCalibrationError, logLoss } from "./metrics";

export type HistoricalPrediction = {
  gameId: string;
  startsAt: string;
  featureSnapshotAt: string;
  predictedHomeWin: number;
  homeWon: boolean;
};

export type BacktestSummary = {
  sampleSize: number;
  brier: number;
  logLoss: number;
  calibrationError: number;
  leakageViolations: string[];
};

export function runChronologicalBacktest(rows: HistoricalPrediction[]): BacktestSummary {
  const ordered = [...rows].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );

  const leakageViolations: string[] = [];

  for (const row of ordered) {
    if (new Date(row.featureSnapshotAt).getTime() > new Date(row.startsAt).getTime()) {
      leakageViolations.push(row.gameId);
    }
    if (row.predictedHomeWin < 0 || row.predictedHomeWin > 1) {
      throw new Error(`Prediction for ${row.gameId} is outside the [0,1] probability range.`);
    }
  }

  const clean = ordered.filter((row) => !leakageViolations.includes(row.gameId));
  const results = clean.map((row) => ({
    probability: row.predictedHomeWin,
    outcome: (row.homeWon ? 1 : 0) as 0 | 1
  }));

  return {
    sampleSize: clean.length,
    brier: brierScore(results),
    logLoss: logLoss(results),
    calibrationError: expectedCalibrationError(results),
    leakageViolations
  };
}
