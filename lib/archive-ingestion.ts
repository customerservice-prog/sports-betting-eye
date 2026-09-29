import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { getDatabasePool } from "./persistence";

type CsvRow = Record<string, string>;

export async function ensureArchiveSchema() {
  const db = getDatabasePool();
  if (!db) return false;

  await db.query(`
    CREATE TABLE IF NOT EXISTS archive_games (
      source TEXT NOT NULL,
      league TEXT NOT NULL,
      source_game_id TEXT NOT NULL,
      season INTEGER,
      starts_at TIMESTAMPTZ,
      away_team TEXT,
      home_team TEXT,
      away_score INTEGER,
      home_score INTEGER,
      status TEXT NOT NULL DEFAULT 'final',
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(source, league, source_game_id)
    );

    CREATE TABLE IF NOT EXISTS archive_records (
      source TEXT NOT NULL,
      league TEXT NOT NULL,
      season INTEGER NOT NULL,
      dataset TEXT NOT NULL,
      record_key TEXT NOT NULL,
      payload JSONB NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(source, league, season, dataset, record_key)
    );

    CREATE TABLE IF NOT EXISTS archive_state (
      source TEXT NOT NULL,
      stream TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(source, stream)
    );

    CREATE INDEX IF NOT EXISTS idx_archive_games_league_date
      ON archive_games(league, starts_at);
    CREATE INDEX IF NOT EXISTS idx_archive_records_lookup
      ON archive_records(source, league, season, dataset);
  `);
  return true;
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: { "user-agent": "SportsEye/0.6 archive-ingestion", accept: "text/csv,*/*" },
    cache: "no-store",
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw new Error(`Archive request failed ${response.status}: ${url}`);
  return response.text();
}

async function fetchBuffer(url: string) {
  const response = await fetch(url, {
    headers: { "user-agent": "SportsEye/0.6 archive-ingestion", accept: "application/zip,*/*" },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`Archive request failed ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function rows(text: string): CsvRow[] {
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    bom: true
  }) as CsvRow[];
}

function int(value?: string) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateIso(value?: string, time?: string) {
  if (!value) return null;
  const clean = value.trim();
  let year = 0;
  let month = 0;
  let day = 0;

  const dashed = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const compact = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
  const slash = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (dashed) {
    year = Number(dashed[1]); month = Number(dashed[2]); day = Number(dashed[3]);
  } else if (compact) {
    year = Number(compact[1]); month = Number(compact[2]); day = Number(compact[3]);
  } else if (slash) {
    year = Number(slash[3]); month = Number(slash[1]); day = Number(slash[2]);
  } else {
    const parsed = new Date(clean);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  let hour = 12;
  let minute = 0;
  if (time) {
    const match = time.trim().match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      hour = Number(match[1]);
      minute = Number(match[2]);
    }
  }

  return new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString();
}

async function upsertGames(
  source: string,
  league: string,
  games: Array<{
    id: string;
    season: number | null;
    startsAt: string | null;
    awayTeam: string;
    homeTeam: string;
    awayScore: number | null;
    homeScore: number | null;
    raw: CsvRow;
  }>
) {
  const db = getDatabasePool();
  if (!db || !games.length) return 0;
  await ensureArchiveSchema();

  let stored = 0;
  for (let offset = 0; offset < games.length; offset += 200) {
    const batch = games.slice(offset, offset + 200);
    const values: unknown[] = [];
    const tuples = batch.map((game, index) => {
      const base = index * 10;
      values.push(
        source,
        league,
        game.id,
        game.season,
        game.startsAt,
        game.awayTeam,
        game.homeTeam,
        game.awayScore,
        game.homeScore,
        JSON.stringify(game.raw)
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},'final',$${base + 10}::jsonb,NOW())`;
    });

    await db.query(
      `INSERT INTO archive_games (
        source, league, source_game_id, season, starts_at, away_team, home_team,
        away_score, home_score, status, raw, imported_at
      ) VALUES ${tuples.join(",")}
      ON CONFLICT (source, league, source_game_id) DO UPDATE SET
        season=EXCLUDED.season,
        starts_at=EXCLUDED.starts_at,
        away_team=EXCLUDED.away_team,
        home_team=EXCLUDED.home_team,
        away_score=EXCLUDED.away_score,
        home_score=EXCLUDED.home_score,
        raw=EXCLUDED.raw,
        imported_at=NOW()`,
      values
    );
    stored += batch.length;
  }
  return stored;
}

function recordKey(dataset: string, row: CsvRow, index: number) {
  const parts = [
    row.gid,
    row.id,
    row.team,
    row.date,
    row.number,
    row.stattype,
    row.b_seq,
    row.p_seq,
    row.d_seq,
    row.d_pos
  ].filter(Boolean);
  return parts.length ? parts.join(":") : `${dataset}:${index}`;
}

async function upsertRecords(
  source: string,
  league: string,
  season: number,
  dataset: string,
  input: CsvRow[]
) {
  const db = getDatabasePool();
  if (!db || !input.length) return 0;
  await ensureArchiveSchema();

  let stored = 0;
  for (let offset = 0; offset < input.length; offset += 250) {
    const batch = input.slice(offset, offset + 250);
    const values: unknown[] = [];
    const tuples = batch.map((row, index) => {
      const base = index * 6;
      values.push(
        source,
        league,
        season,
        dataset,
        recordKey(dataset, row, offset + index),
        JSON.stringify(row)
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6}::jsonb,NOW())`;
    });

    await db.query(
      `INSERT INTO archive_records (
        source, league, season, dataset, record_key, payload, imported_at
      ) VALUES ${tuples.join(",")}
      ON CONFLICT (source, league, season, dataset, record_key) DO UPDATE SET
        payload=EXCLUDED.payload,
        imported_at=NOW()`,
      values
    );
    stored += batch.length;
  }
  return stored;
}

async function state(source: string, stream: string) {
  const db = getDatabasePool();
  if (!db) return null;
  await ensureArchiveSchema();
  const result = await db.query(
    "SELECT payload FROM archive_state WHERE source=$1 AND stream=$2",
    [source, stream]
  );
  return result.rows[0]?.payload ?? null;
}

async function saveState(source: string, stream: string, payload: unknown) {
  const db = getDatabasePool();
  if (!db) return;
  await ensureArchiveSchema();
  await db.query(
    `INSERT INTO archive_state (source, stream, payload, updated_at)
     VALUES ($1,$2,$3::jsonb,NOW())
     ON CONFLICT (source, stream) DO UPDATE SET payload=EXCLUDED.payload, updated_at=NOW()`,
    [source, stream, JSON.stringify(payload)]
  );
}

export async function importNflverseGames() {
  const source = "nflverse";
  const url = process.env.NFLVERSE_GAMES_URL ??
    "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
  const text = await fetchText(url);
  const parsed = rows(text);
  const games = parsed.flatMap((row) => {
    if (!row.game_id || !row.gameday || !row.home_team || !row.away_team) return [];
    const homeScore = int(row.home_score);
    const awayScore = int(row.away_score);
    if (homeScore === null || awayScore === null) return [];
    return [{
      id: row.game_id,
      season: int(row.season),
      startsAt: dateIso(row.gameday, row.gametime),
      awayTeam: row.away_team,
      homeTeam: row.home_team,
      awayScore,
      homeScore,
      raw: row
    }];
  });

  const stored = await upsertGames(source, "NFL", games);
  const seasons = games.map((game) => game.season).filter((value): value is number => value !== null);
  await saveState(source, "games", {
    lastImportedAt: new Date().toISOString(),
    rows: parsed.length,
    games: stored,
    minSeason: seasons.length ? Math.min(...seasons) : null,
    maxSeason: seasons.length ? Math.max(...seasons) : null,
    sourceUrl: url
  });
  return { source, rows: parsed.length, games: stored };
}

const DEFAULT_RETROSHEET_DATASETS = [
  "gameinfo",
  "allplayers",
  "teamstats",
  "batting",
  "pitching",
  "fielding"
];

export async function importRetrosheetSeason() {
  const source = "retrosheet";
  const current = await state(source, "season-cursor") as { nextSeason?: number } | null;
  const firstSeason = Number(process.env.RETROSHEET_START_SEASON || 2025);
  const minSeason = Number(process.env.RETROSHEET_MIN_SEASON || 1897);
  const season = Math.max(minSeason, Math.min(firstSeason, Number(current?.nextSeason ?? firstSeason)));

  const url = `https://www.retrosheet.org/downloads/${season}/${season}csvs.zip`;
  const zip = new AdmZip(await fetchBuffer(url));
  const entries = zip.getEntries();

  const find = (name: string) =>
    entries.find((entry) => entry.entryName.toLowerCase().endsWith(`${name}.csv`));

  const gameEntry = find("gameinfo");
  if (!gameEntry) throw new Error(`Retrosheet ${season} archive has no gameinfo.csv`);

  const gameRows = rows(gameEntry.getData().toString("utf8"));
  const games = gameRows.flatMap((row) => {
    if (!row.gid || !row.hometeam || !row.visteam || !row.date) return [];
    return [{
      id: row.gid,
      season: int(row.season) ?? season,
      startsAt: dateIso(row.date, row.starttime),
      awayTeam: row.visteam,
      homeTeam: row.hometeam,
      awayScore: int(row.vruns),
      homeScore: int(row.hruns),
      raw: row
    }];
  });

  const gamesStored = await upsertGames(source, "MLB", games);
  const configured = (process.env.RETROSHEET_DATASETS ?? DEFAULT_RETROSHEET_DATASETS.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const datasets: Record<string, number> = {};
  for (const dataset of configured) {
    const entry = find(dataset);
    if (!entry) {
      datasets[dataset] = 0;
      continue;
    }
    const parsed = rows(entry.getData().toString("utf8"));
    datasets[dataset] = await upsertRecords(source, "MLB", season, dataset, parsed);
  }

  const nextSeason = season - 1;
  const complete = season <= minSeason;
  await saveState(source, "season-cursor", {
    lastSeasonImported: season,
    nextSeason: complete ? minSeason : nextSeason,
    minSeason,
    complete,
    lastImportedAt: new Date().toISOString(),
    gamesStored,
    datasets,
    sourceUrl: url
  });

  return { source, season, gamesStored, datasets, complete };
}

export async function getArchiveStats() {
  const db = getDatabasePool();
  if (!db) return {
    games: 0,
    nflGames: 0,
    mlbGames: 0,
    records: 0,
    retrosheetState: null,
    nflverseState: null
  };
  await ensureArchiveSchema();

  const [counts, retrosheetState, nflverseState] = await Promise.all([
    db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM archive_games) AS games,
        (SELECT COUNT(*)::int FROM archive_games WHERE source='nflverse') AS nfl_games,
        (SELECT COUNT(*)::int FROM archive_games WHERE source='retrosheet') AS mlb_games,
        (SELECT COUNT(*)::int FROM archive_records) AS records
    `),
    state("retrosheet", "season-cursor"),
    state("nflverse", "games")
  ]);

  const row = counts.rows[0] ?? {};
  return {
    games: Number(row.games ?? 0),
    nflGames: Number(row.nfl_games ?? 0),
    mlbGames: Number(row.mlb_games ?? 0),
    records: Number(row.records ?? 0),
    retrosheetState,
    nflverseState
  };
}
