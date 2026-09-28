export type EloState = Record<string, number>;

export type EloGame = {
  homeTeam: string;
  awayTeam: string;
  homeWon: boolean;
  neutralSite?: boolean;
};

export type EloConfig = {
  initialRating: number;
  kFactor: number;
  homeAdvantage: number;
};

export const defaultEloConfig: EloConfig = {
  initialRating: 1500,
  kFactor: 20,
  homeAdvantage: 55
};

export function winProbability(ratingA: number, ratingB: number) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function predictEloGame(
  state: EloState,
  homeTeam: string,
  awayTeam: string,
  neutralSite = false,
  config: EloConfig = defaultEloConfig
) {
  const home = state[homeTeam] ?? config.initialRating;
  const away = state[awayTeam] ?? config.initialRating;
  const adjustedHome = home + (neutralSite ? 0 : config.homeAdvantage);

  return {
    homeRating: home,
    awayRating: away,
    homeWinProbability: winProbability(adjustedHome, away)
  };
}

export function applyEloResult(
  state: EloState,
  game: EloGame,
  config: EloConfig = defaultEloConfig
): EloState {
  const prediction = predictEloGame(state, game.homeTeam, game.awayTeam, game.neutralSite, config);
  const actualHome = game.homeWon ? 1 : 0;
  const change = config.kFactor * (actualHome - prediction.homeWinProbability);

  return {
    ...state,
    [game.homeTeam]: prediction.homeRating + change,
    [game.awayTeam]: prediction.awayRating - change
  };
}
