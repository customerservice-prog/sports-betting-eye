import { applyEloResult, predictEloGame, type EloState } from "./elo";

export type CompletedGame = {
  id: string;
  league: string;
  startsAt: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
};

export type TeamForm = {
  games: number;
  wins: number;
  pointsFor: number;
  pointsAgainst: number;
  margins: number[];
};

export type LeagueModelState = {
  elo: EloState;
  forms: Record<string, TeamForm>;
  completedGames: number;
  absoluteMargins: number[];
};

export type ModelPrediction = {
  modelName: "elo-real-games" | "recent-form" | "sports-ensemble";
  version: "v1";
  homeWinProbability: number;
  predictedHomeScore: number | null;
  predictedAwayScore: number | null;
  uncertainty: number;
  features: Record<string, number | string | boolean | null>;
};

export function createLeagueModelState(): LeagueModelState {
  return { elo: {}, forms: {}, completedGames: 0, absoluteMargins: [] };
}

function clamp(value: number, min = 0.03, max = 0.97) {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function teamForm(state: LeagueModelState, team: string): TeamForm {
  return state.forms[team] ?? {
    games: 0,
    wins: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    margins: []
  };
}

function recentAverage(values: number[], limit = 12) {
  const selected = values.slice(-limit);
  if (!selected.length) return 0;
  return selected.reduce((sum, value) => sum + value, 0) / selected.length;
}

function averagePoints(form: TeamForm, side: "for" | "against") {
  if (!form.games) return null;
  return (side === "for" ? form.pointsFor : form.pointsAgainst) / form.games;
}

export function predictRealModels(
  state: LeagueModelState,
  homeTeam: string,
  awayTeam: string
): ModelPrediction[] {
  const output: ModelPrediction[] = [];
  const elo = predictEloGame(state.elo, homeTeam, awayTeam);
  const homeForm = teamForm(state, homeTeam);
  const awayForm = teamForm(state, awayTeam);
  const homeFor = averagePoints(homeForm, "for");
  const homeAgainst = averagePoints(homeForm, "against");
  const awayFor = averagePoints(awayForm, "for");
  const awayAgainst = averagePoints(awayForm, "against");

  const projectedHome =
    homeFor !== null && awayAgainst !== null ? (homeFor + awayAgainst) / 2 : null;
  const projectedAway =
    awayFor !== null && homeAgainst !== null ? (awayFor + homeAgainst) / 2 : null;

  output.push({
    modelName: "elo-real-games",
    version: "v1",
    homeWinProbability: clamp(elo.homeWinProbability),
    predictedHomeScore: projectedHome,
    predictedAwayScore: projectedAway,
    uncertainty: Math.max(0.08, 0.46 - Math.abs(elo.homeWinProbability - 0.5)),
    features: {
      leagueSampleSize: state.completedGames,
      homeRating: Math.round(elo.homeRating * 10) / 10,
      awayRating: Math.round(elo.awayRating * 10) / 10,
      homeGames: homeForm.games,
      awayGames: awayForm.games
    }
  });

  if (homeForm.games >= 5 && awayForm.games >= 5) {
    const homeWinRate = homeForm.wins / homeForm.games;
    const awayWinRate = awayForm.wins / awayForm.games;
    const leagueMarginScale = Math.max(1, recentAverage(state.absoluteMargins, 200));
    const homeMargin = recentAverage(homeForm.margins, 12) / leagueMarginScale;
    const awayMargin = recentAverage(awayForm.margins, 12) / leagueMarginScale;
    const formLogit =
      0.18 +
      1.35 * (homeWinRate - awayWinRate) +
      0.72 * (homeMargin - awayMargin);
    const formProbability = clamp(sigmoid(formLogit));

    output.push({
      modelName: "recent-form",
      version: "v1",
      homeWinProbability: formProbability,
      predictedHomeScore: projectedHome,
      predictedAwayScore: projectedAway,
      uncertainty: Math.max(0.1, 0.5 - Math.abs(formProbability - 0.5)),
      features: {
        homeWinRate,
        awayWinRate,
        homeRecentNormalizedMargin: homeMargin,
        awayRecentNormalizedMargin: awayMargin,
        homeGames: homeForm.games,
        awayGames: awayForm.games,
        leagueMarginScale
      }
    });

    const ensembleProbability = clamp(elo.homeWinProbability * 0.65 + formProbability * 0.35);
    output.push({
      modelName: "sports-ensemble",
      version: "v1",
      homeWinProbability: ensembleProbability,
      predictedHomeScore: projectedHome,
      predictedAwayScore: projectedAway,
      uncertainty: Math.max(0.07, 0.43 - Math.abs(ensembleProbability - 0.5)),
      features: {
        eloProbability: elo.homeWinProbability,
        formProbability,
        eloWeight: 0.65,
        formWeight: 0.35,
        leagueSampleSize: state.completedGames
      }
    });
  }

  return output;
}

export function applyCompletedGame(state: LeagueModelState, game: CompletedGame): LeagueModelState {
  state.elo = applyEloResult(state.elo, {
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    homeWon: game.homeScore > game.awayScore
  });

  const update = (team: string, won: boolean, pointsFor: number, pointsAgainst: number) => {
    const current = teamForm(state, team);
    const next: TeamForm = {
      games: current.games + 1,
      wins: current.wins + (won ? 1 : 0),
      pointsFor: current.pointsFor + pointsFor,
      pointsAgainst: current.pointsAgainst + pointsAgainst,
      margins: [...current.margins, pointsFor - pointsAgainst].slice(-20)
    };
    state.forms[team] = next;
  };

  const homeWon = game.homeScore > game.awayScore;
  update(game.homeTeam, homeWon, game.homeScore, game.awayScore);
  update(game.awayTeam, !homeWon, game.awayScore, game.homeScore);
  state.absoluteMargins.push(Math.abs(game.homeScore - game.awayScore));
  state.absoluteMargins = state.absoluteMargins.slice(-500);
  state.completedGames += 1;
  return state;
}
