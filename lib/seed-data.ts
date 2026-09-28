import { GamePrediction, MistakeCase, ModelCard, ProofMetric } from "./types";

export const demoGames: GamePrediction[] = [
  {
    id: "nfl-buf-mia",
    league: "NFL",
    startLabel: "Demo slate • 8:20 PM",
    venue: "Synthetic matchup",
    away: { name: "Miami", short: "MIA", record: "Demo", colorHint: "aqua" },
    home: { name: "Buffalo", short: "BUF", record: "Demo", colorHint: "blue" },
    homeWin: 67,
    awayWin: 33,
    predictedAwayScore: 21,
    predictedHomeScore: 27,
    predictedMargin: 6,
    confidence: "HIGH",
    status: "PROOF PICK",
    uncertainty: 18,
    edgeVsBaseline: 7.2,
    modelAgreement: 75,
    factorSummary: [
      "Opponent-adjusted efficiency favors Buffalo",
      "Home field and rest profile add modest support",
      "Quarterback efficiency models agree on Buffalo",
      "Explosive-play defense is the strongest counter-signal"
    ],
    riskFlags: ["Late injury uncertainty", "Turnover variance"],
    modelVotes: [
      { name: "Ensemble v1", homeWin: 67, weight: 1.0, status: "champion" },
      { name: "Elo+", homeWin: 63, weight: 0.72, status: "challenger" },
      { name: "Gradient Boost", homeWin: 70, weight: 0.86, status: "challenger" },
      { name: "Player Impact", homeWin: 66, weight: 0.82, status: "challenger" }
    ]
  },
  {
    id: "nba-nyk-bos",
    league: "NBA",
    startLabel: "Demo slate • 7:30 PM",
    venue: "Synthetic matchup",
    away: { name: "Boston", short: "BOS", record: "Demo", colorHint: "green" },
    home: { name: "New York", short: "NYK", record: "Demo", colorHint: "orange" },
    homeWin: 54,
    awayWin: 46,
    predictedAwayScore: 111,
    predictedHomeScore: 114,
    predictedMargin: 3,
    confidence: "MEDIUM",
    status: "EXPERIMENT",
    uncertainty: 29,
    edgeVsBaseline: 2.6,
    modelAgreement: 56,
    factorSummary: [
      "Home-court signal is positive but small",
      "Pace model projects a high-possession game",
      "Recent efficiency and long-term strength disagree",
      "Bench rotation creates wider score uncertainty"
    ],
    riskFlags: ["Model disagreement", "Rotation uncertainty"],
    modelVotes: [
      { name: "Ensemble v1", homeWin: 54, weight: 1.0, status: "champion" },
      { name: "Elo+", homeWin: 49, weight: 0.72, status: "challenger" },
      { name: "Gradient Boost", homeWin: 58, weight: 0.86, status: "challenger" },
      { name: "Player Impact", homeWin: 56, weight: 0.82, status: "challenger" }
    ]
  },
  {
    id: "mlb-lad-sd",
    league: "MLB",
    startLabel: "Demo slate • 9:40 PM",
    venue: "Synthetic matchup",
    away: { name: "Los Angeles", short: "LAD", record: "Demo", colorHint: "blue" },
    home: { name: "San Diego", short: "SD", record: "Demo", colorHint: "gold" },
    homeWin: 48,
    awayWin: 52,
    predictedAwayScore: 4,
    predictedHomeScore: 4,
    predictedMargin: 0,
    confidence: "LOW",
    status: "NO PICK",
    uncertainty: 41,
    edgeVsBaseline: 0.8,
    modelAgreement: 49,
    factorSummary: [
      "Starting-pitcher models nearly cancel out",
      "Bullpen projections are close",
      "Park-adjusted offense slightly favors Los Angeles",
      "Expected run distribution is too wide for proof status"
    ],
    riskFlags: ["High variance", "No meaningful edge"],
    modelVotes: [
      { name: "Ensemble v1", homeWin: 48, weight: 1.0, status: "champion" },
      { name: "Elo+", homeWin: 46, weight: 0.72, status: "challenger" },
      { name: "Gradient Boost", homeWin: 51, weight: 0.86, status: "challenger" },
      { name: "Player Impact", homeWin: 47, weight: 0.82, status: "challenger" }
    ]
  },
  {
    id: "nhl-nyr-tor",
    league: "NHL",
    startLabel: "Demo slate • 7:00 PM",
    venue: "Synthetic matchup",
    away: { name: "Toronto", short: "TOR", record: "Demo", colorHint: "blue" },
    home: { name: "New York", short: "NYR", record: "Demo", colorHint: "red" },
    homeWin: 61,
    awayWin: 39,
    predictedAwayScore: 2,
    predictedHomeScore: 4,
    predictedMargin: 2,
    confidence: "MEDIUM",
    status: "EXPERIMENT",
    uncertainty: 25,
    edgeVsBaseline: 4.3,
    modelAgreement: 68,
    factorSummary: [
      "Goalie-adjusted form favors New York",
      "Special-teams projection creates a moderate edge",
      "Shot-quality model is supportive",
      "One challenger still rates Toronto closer to even"
    ],
    riskFlags: ["Goalie variance"],
    modelVotes: [
      { name: "Ensemble v1", homeWin: 61, weight: 1.0, status: "champion" },
      { name: "Elo+", homeWin: 57, weight: 0.72, status: "challenger" },
      { name: "Gradient Boost", homeWin: 64, weight: 0.86, status: "challenger" },
      { name: "Player Impact", homeWin: 60, weight: 0.82, status: "challenger" }
    ]
  }
];

export const modelCards: ModelCard[] = [
  {
    name: "Sports Ensemble",
    role: "Champion",
    version: "v0.1",
    brier: 0.188,
    logLoss: 0.571,
    calibrationError: 0.031,
    scoreMae: 7.8,
    sampleSize: 4200,
    note: "Weighted blend of strength, matchup, player-impact, and context models."
  },
  {
    name: "Gradient Boost",
    role: "Challenger",
    version: "v0.1",
    brier: 0.193,
    logLoss: 0.584,
    calibrationError: 0.038,
    scoreMae: 7.5,
    sampleSize: 4200,
    note: "High-dimensional nonlinear feature learner."
  },
  {
    name: "Elo+ Context",
    role: "Challenger",
    version: "v0.1",
    brier: 0.205,
    logLoss: 0.611,
    calibrationError: 0.044,
    scoreMae: 8.3,
    sampleSize: 4200,
    note: "Stable long-term team strength with venue and rest adjustments."
  },
  {
    name: "Player Impact",
    role: "Challenger",
    version: "v0.1",
    brier: 0.199,
    logLoss: 0.598,
    calibrationError: 0.041,
    scoreMae: 7.9,
    sampleSize: 4200,
    note: "Expected starter availability and role-weighted player impact."
  }
];

export const mistakeCases: MistakeCase[] = [
  {
    id: "miss-001",
    title: "High-confidence favorite failed",
    league: "NFL",
    predicted: "Home 78%",
    result: "Home lost 17–24",
    confidence: 78,
    severity: "Critical",
    rootCause: "Pressure-rate feature was underweighted while opponent strength was overstated by schedule quality.",
    lesson: "Increase opponent-adjusted pressure interaction and automatically downgrade confidence when schedule-strength disagreement is large.",
    tags: ["high-confidence", "favorite", "pressure", "schedule"]
  },
  {
    id: "miss-002",
    title: "Late lineup change not reflected",
    league: "NBA",
    predicted: "Away 64%",
    result: "Away lost by 11",
    confidence: 64,
    severity: "High",
    rootCause: "Projected starter availability snapshot was stale at prediction lock time.",
    lesson: "Invalidate any proof pick when a material lineup update lands after the last verified roster snapshot.",
    tags: ["lineup", "stale-data", "proof-gate"]
  },
  {
    id: "miss-003",
    title: "Recent form overreaction",
    league: "NHL",
    predicted: "Home 69%",
    result: "Home lost 1–3",
    confidence: 69,
    severity: "Medium",
    rootCause: "Short-window goalie form received too much weight relative to longer-term shot quality.",
    lesson: "Cap recency boost unless supported by underlying expected-goal measures.",
    tags: ["recency", "goalie", "calibration"]
  }
];

export const proofMetrics: ProofMetric[] = [
  {
    label: "Time-machine leakage test",
    value: "PASS",
    detail: "Historical evaluation must use only information available before each simulated game.",
    status: "pass"
  },
  {
    label: "Probability calibration",
    value: "WATCH",
    detail: "Starter demo metrics are illustrative until real historical feeds are connected.",
    status: "watch"
  },
  {
    label: "Recent holdout",
    value: "LOCKED",
    detail: "Requires imported historical seasons and a sealed chronological holdout.",
    status: "locked"
  },
  {
    label: "Live shadow proof",
    value: "LOCKED",
    detail: "Requires real pregame feed snapshots and postgame grading.",
    status: "locked"
  },
  {
    label: "Real-money execution",
    value: "LOCKED",
    detail: "Sports Eye is simulation-only in this build.",
    status: "locked"
  }
];
