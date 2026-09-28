export type League = "NFL" | "NBA" | "MLB" | "NHL" | "NCAAF" | "NCAAB";
export type PickStatus = "PROOF PICK" | "EXPERIMENT" | "NO PICK";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";

export type TeamSide = {
  name: string;
  short: string;
  record: string;
  colorHint: string;
};

export type ModelVote = {
  name: string;
  homeWin: number;
  weight: number;
  status: "champion" | "challenger";
};

export type GamePrediction = {
  id: string;
  league: League;
  startLabel: string;
  venue: string;
  away: TeamSide;
  home: TeamSide;
  homeWin: number;
  awayWin: number;
  predictedAwayScore: number;
  predictedHomeScore: number;
  predictedMargin: number;
  confidence: Confidence;
  status: PickStatus;
  uncertainty: number;
  edgeVsBaseline: number;
  modelAgreement: number;
  factorSummary: string[];
  riskFlags: string[];
  modelVotes: ModelVote[];
};

export type ModelCard = {
  name: string;
  role: "Champion" | "Challenger";
  version: string;
  brier: number;
  logLoss: number;
  calibrationError: number;
  scoreMae: number;
  sampleSize: number;
  note: string;
};

export type MistakeCase = {
  id: string;
  title: string;
  league: League;
  predicted: string;
  result: string;
  confidence: number;
  severity: "Critical" | "High" | "Medium";
  rootCause: string;
  lesson: string;
  tags: string[];
};

export type ProofMetric = {
  label: string;
  value: string;
  detail: string;
  status: "pass" | "watch" | "locked";
};

export type PaperState = {
  proofBankroll: number;
  explorationBankroll: number;
  simulatedDecisions: number;
  proofPicks: number;
  wins: number;
  losses: number;
  brier: number;
  calibrationError: number;
  lastBatchAt: string | null;
};
