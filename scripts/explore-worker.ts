import { runPersistentExplorationBatch } from "../lib/persistence";
import { ingestCurrentSportsData } from "../lib/ingestion";

async function main() {
  const ingestion = await ingestCurrentSportsData().catch((error) => ({
    provider: "espn-public",
    totalGames: 0,
    byLeague: {},
    errors: [{ league: "SYSTEM", message: error instanceof Error ? error.message : "Ingestion failed" }],
    completedAt: new Date().toISOString()
  }));

  const batchSize = Math.max(1, Number(process.env.EXPLORATION_BATCH_SIZE || 5000));
  const batches = Math.max(1, Number(process.env.EXPLORATION_BATCHES_PER_RUN || 20));

  let state = null;

  for (let i = 0; i < batches; i += 1) {
    state = await runPersistentExplorationBatch(batchSize);
  }

  console.log(JSON.stringify({
    ok: true,
    mode: "real-schedule-ingestion-plus-synthetic-paper-exploration",
    realGamesIngested: ingestion.totalGames,
    ingestionErrors: ingestion.errors.length,
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
