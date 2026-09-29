import { gradeCompletedPredictions, generateScheduledBaselinePredictions, runPersistentExplorationBatch } from "../lib/persistence";
import { backfillHistoricalChunk, ingestCurrentSportsData } from "../lib/ingestion";
import { ingestSportsIntelligence } from "../lib/intelligence-ingestion";
import { evaluateRealModels } from "../lib/model-evaluation";

async function main() {
  const ingestion = await ingestCurrentSportsData().catch((error) => ({
    provider: "espn-public",
    totalGames: 0,
    byLeague: {},
    errors: [{ league: "SYSTEM", message: error instanceof Error ? error.message : "Ingestion failed" }],
    completedAt: new Date().toISOString()
  }));

  const backfill = await backfillHistoricalChunk(
    Math.max(1, Number(process.env.HISTORICAL_BACKFILL_DAYS_PER_RUN || 7))
  ).catch((error) => ({
    complete: false,
    chunksCompleted: 0,
    gamesStored: 0,
    gamesAdded: 0,
    errors: [{ league: "SYSTEM", message: error instanceof Error ? error.message : "Backfill failed" }]
  }));

  const intelligence = await ingestSportsIntelligence().catch((error) => ({
    teamsUpdated: 0,
    playersUpdated: 0,
    profilesUpdated: 0,
    gamePackagesUpdated: 0,
    leagueSnapshotsUpdated: 0,
    teamSnapshotsUpdated: 0,
    errors: [{ scope: "SYSTEM", message: error instanceof Error ? error.message : "Intelligence ingestion failed" }],
    completedAt: new Date().toISOString()
  }));

  const predictionGeneration = await generateScheduledBaselinePredictions(500).catch((error) => ({
    created: 0,
    skipped: 0,
    error: error instanceof Error ? error.message : "Prediction generation failed"
  }));

  const grading = await gradeCompletedPredictions(1000).catch((error) => ({
    graded: 0,
    mistakesCreated: 0,
    error: error instanceof Error ? error.message : "Prediction grading failed"
  }));

  const modelEvaluation = await evaluateRealModels().catch((error) => ({
    groups: 0,
    rows: 0,
    error: error instanceof Error ? error.message : "Model evaluation failed"
  }));

  const batchSize = Math.max(1, Number(process.env.EXPLORATION_BATCH_SIZE || 5000));
  const batches = Math.max(1, Number(process.env.EXPLORATION_BATCHES_PER_RUN || 20));

  let state = null;

  for (let i = 0; i < batches; i += 1) {
    state = await runPersistentExplorationBatch(batchSize);
  }

  console.log(JSON.stringify({
    ok: true,
    mode: "real-sports-data-lake-plus-prediction-proof-plus-paper-exploration",
    realGamesIngested: ingestion.totalGames,
    ingestionErrors: ingestion.errors.length,
    historicalGamesAdded: backfill.gamesAdded,
    historicalGamesStored: backfill.gamesStored,
    historicalBackfillChunks: backfill.chunksCompleted,
    historicalBackfillComplete: backfill.complete,
    historicalBackfillErrors: backfill.errors.length,
    intelligenceTeamsUpdated: intelligence.teamsUpdated,
    intelligencePlayersUpdated: intelligence.playersUpdated,
    intelligenceProfilesUpdated: intelligence.profilesUpdated,
    intelligenceGamePackagesUpdated: intelligence.gamePackagesUpdated,
    intelligenceLeagueSnapshotsUpdated: intelligence.leagueSnapshotsUpdated,
    intelligenceTeamSnapshotsUpdated: intelligence.teamSnapshotsUpdated,
    intelligenceErrors: intelligence.errors.length,
    realPredictionsCreated: predictionGeneration.created,
    realPredictionsSkipped: predictionGeneration.skipped,
    predictionsGraded: grading.graded,
    mistakesCreated: grading.mistakesCreated,
    modelEvaluationGroups: modelEvaluation.groups,
    modelEvaluationRows: modelEvaluation.rows,
    batches,
    batchSize,
    decisionsAdded: batches * batchSize,
    simulatedDecisions: state?.simulatedDecisions ?? 0,
    explorationBankroll: state?.explorationBankroll ?? 0,
    brier: state?.brier ?? null,
    completedAt: new Date().toISOString()
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
