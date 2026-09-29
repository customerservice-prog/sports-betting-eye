import { importNflverseGames, importRetrosheetSeason } from "../lib/archive-ingestion";

async function main() {
  const startedAt = new Date().toISOString();

  const nfl = await importNflverseGames().catch((error) => ({
    source: "nflverse",
    rows: 0,
    games: 0,
    error: error instanceof Error ? error.message : "NFL archive import failed"
  }));

  const mlb = await importRetrosheetSeason().catch((error) => ({
    source: "retrosheet",
    season: null,
    gamesStored: 0,
    datasets: {},
    complete: false,
    error: error instanceof Error ? error.message : "MLB archive import failed"
  }));

  console.log(JSON.stringify({
    ok: !("error" in nfl) && !("error" in mlb),
    job: "deep-sports-archive",
    startedAt,
    nflverse: nfl,
    retrosheet: mlb,
    completedAt: new Date().toISOString()
  }));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
