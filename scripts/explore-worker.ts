import { runPersistentExplorationBatch } from "../lib/persistence";

async function main() {
  const batchSize = Math.max(1, Number(process.env.EXPLORATION_BATCH_SIZE || 5000));
  const batches = Math.max(1, Number(process.env.EXPLORATION_BATCHES_PER_RUN || 20));

  let state = null;

  for (let i = 0; i < batches; i += 1) {
    state = await runPersistentExplorationBatch(batchSize);
  }

  console.log(JSON.stringify({
    ok: true,
    mode: "synthetic-paper-exploration",
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
