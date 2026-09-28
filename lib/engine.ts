import { PaperState } from "./types";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function createInitialPaperState(): PaperState {
  return {
    proofBankroll: 100000,
    explorationBankroll: 100000,
    simulatedDecisions: 0,
    proofPicks: 0,
    wins: 0,
    losses: 0,
    brier: 0.205,
    calibrationError: 0.047,
    lastBatchAt: null
  };
}

function pseudoRandom(seed: number) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function runExplorationBatch(current: PaperState, batchSize = 250): PaperState {
  let bankroll = current.explorationBankroll;
  let wins = current.wins;
  let losses = current.losses;
  let proofPicks = current.proofPicks;
  let squaredError = current.brier * Math.max(1, current.simulatedDecisions);
  let calibrationDrift = current.calibrationError;

  const baseSeed = current.simulatedDecisions + Math.floor(bankroll);

  for (let i = 0; i < batchSize; i += 1) {
    const signal = 0.51 + pseudoRandom(baseSeed + i * 7) * 0.21;
    const outcome = pseudoRandom(baseSeed + i * 13 + 17) < clamp(signal - 0.018, 0.05, 0.95);
    const stake = 20 + pseudoRandom(baseSeed + i * 19) * 180;
    const decimalOdds = 1.65 + pseudoRandom(baseSeed + i * 23) * 0.85;

    if (outcome) {
      bankroll += stake * (decimalOdds - 1);
      wins += 1;
    } else {
      bankroll -= stake;
      losses += 1;
    }

    if (signal >= 0.66 && pseudoRandom(baseSeed + i * 29) > 0.35) {
      proofPicks += 1;
    }

    squaredError += Math.pow(signal - (outcome ? 1 : 0), 2);
  }

  const total = current.simulatedDecisions + batchSize;
  const brier = squaredError / Math.max(1, total);
  calibrationDrift = clamp(calibrationDrift * 0.985 + Math.abs(0.5 - brier) * 0.002, 0.012, 0.09);

  return {
    ...current,
    explorationBankroll: Math.max(0, Math.round(bankroll * 100) / 100),
    simulatedDecisions: total,
    proofPicks,
    wins,
    losses,
    brier: Math.round(brier * 1000) / 1000,
    calibrationError: Math.round(calibrationDrift * 1000) / 1000,
    lastBatchAt: new Date().toISOString()
  };
}

export function resetPaperState() {
  return createInitialPaperState();
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}
