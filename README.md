# Sports Eye

Sports Eye is a sports-prediction research and simulation system built around one rule: **prediction quality has to be proven, not assumed**.

## Current build

The first release includes:

- Command Center
- Demo game scanner with win probabilities, projected scores, uncertainty, and model agreement
- Sports Brain architecture
- Persistent paper exploration bankroll
- Aggressive synthetic paper-trial runner
- Champion/challenger Model Lab
- Mistake Lab for high-confidence misses and postgame autopsies
- Proof Wall for leakage, calibration, holdout, and live-shadow gates
- Responsive mobile and desktop UI
- Real-money execution locked
- Clear demo-data labeling until external sports feeds are connected

## Important

The starter matchup data and evaluation values in this repository are **synthetic/demo data**. They are present to make the product workflow operable before a historical/live sports data provider is connected. They must not be represented as live predictions or historical model performance.

## Architecture

```
Data Brain
  -> Feature Brain
  -> Prediction Brain
  -> Exploration Engine
  -> Postgame Grader
  -> Mistake Lab
  -> Model Lab
  -> Proof Brain
```

Exploration and Proof are intentionally separated. Exploration may test aggressive ideas with simulated money. Proof requires chronological, leakage-safe testing before any model or strategy can be promoted.

## Next data layer

The next release should add provider adapters for:

- schedules and final scores
- historical games
- rosters and projected starters
- injuries and availability
- team/player statistics
- odds snapshots for benchmarking
- weather where relevant
- play-by-play for live-model research

The ingestion layer should store the timestamp at which every feature became available so historical time-machine tests cannot accidentally see future information.

## Development

```bash
npm install
npm run dev
```

Production compile:

```bash
npm run build
```
