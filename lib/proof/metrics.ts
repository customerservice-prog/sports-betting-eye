export type ProbabilityResult = {
  probability: number;
  outcome: 0 | 1;
};

const EPS = 1e-12;

function clampProbability(value: number) {
  return Math.min(1 - EPS, Math.max(EPS, value));
}

export function brierScore(rows: ProbabilityResult[]) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + Math.pow(row.probability - row.outcome, 2), 0) / rows.length;
}

export function logLoss(rows: ProbabilityResult[]) {
  if (!rows.length) return 0;
  const loss = rows.reduce((sum, row) => {
    const p = clampProbability(row.probability);
    return sum - (row.outcome * Math.log(p) + (1 - row.outcome) * Math.log(1 - p));
  }, 0);
  return loss / rows.length;
}

export function expectedCalibrationError(rows: ProbabilityResult[], bucketCount = 10) {
  if (!rows.length) return 0;
  const buckets = Array.from({ length: bucketCount }, () => [] as ProbabilityResult[]);

  for (const row of rows) {
    const index = Math.min(bucketCount - 1, Math.floor(clampProbability(row.probability) * bucketCount));
    buckets[index].push(row);
  }

  return buckets.reduce((ece, bucket) => {
    if (!bucket.length) return ece;
    const meanPrediction = bucket.reduce((sum, row) => sum + row.probability, 0) / bucket.length;
    const actualRate = bucket.reduce((sum, row) => sum + row.outcome, 0) / bucket.length;
    return ece + (bucket.length / rows.length) * Math.abs(meanPrediction - actualRate);
  }, 0);
}
