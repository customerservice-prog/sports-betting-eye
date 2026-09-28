import { GamePrediction, League } from "@/lib/types";

export type ProviderGame = {
  providerGameId: string;
  league: League;
  startsAt: string;
  homeTeam: string;
  awayTeam: string;
  status: "scheduled" | "live" | "final";
  homeScore?: number;
  awayScore?: number;
  sourceUpdatedAt: string;
};

export type AvailabilitySnapshot = {
  providerGameId: string;
  capturedAt: string;
  players: Array<{
    playerId: string;
    name: string;
    team: string;
    status: "active" | "questionable" | "doubtful" | "out" | "unknown";
    detail?: string;
  }>;
};

export type MarketSnapshot = {
  providerGameId: string;
  capturedAt: string;
  source: string;
  homeMoneyline?: number;
  awayMoneyline?: number;
  spreadHome?: number;
  spreadAway?: number;
  total?: number;
};

export interface SportsDataProvider {
  readonly name: string;
  getSchedule(input: { league: League; from: string; to: string }): Promise<ProviderGame[]>;
  getAvailability?(providerGameId: string): Promise<AvailabilitySnapshot>;
  getMarketSnapshot?(providerGameId: string): Promise<MarketSnapshot[]>;
}

export type PredictionEngine = {
  predict(input: {
    game: ProviderGame;
    asOf: string;
    availability?: AvailabilitySnapshot;
    market?: MarketSnapshot[];
  }): Promise<GamePrediction>;
};
