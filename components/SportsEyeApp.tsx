"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  ChevronRight,
  CircleDollarSign,
  Database,
  FlaskConical,
  Gauge,
  Layers3,
  LockKeyhole,
  Menu,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  X,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { demoGames, mistakeCases, modelCards, proofMetrics } from "@/lib/seed-data";
import {
  createInitialPaperState,
  formatMoney,
  resetPaperState,
  runExplorationBatch
} from "@/lib/engine";
import { GamePrediction, League, PaperState } from "@/lib/types";

type View = "overview" | "games" | "brain" | "bankroll" | "models" | "mistakes" | "proof";

const navItems: { key: View; label: string; icon: typeof Activity }[] = [
  { key: "overview", label: "Command Center", icon: Activity },
  { key: "games", label: "Games", icon: Trophy },
  { key: "brain", label: "Sports Brain", icon: BrainCircuit },
  { key: "bankroll", label: "Paper Bankroll", icon: CircleDollarSign },
  { key: "models", label: "Model Lab", icon: FlaskConical },
  { key: "mistakes", label: "Mistake Lab", icon: AlertTriangle },
  { key: "proof", label: "Proof Wall", icon: ShieldCheck }
];

const leagueOptions: ("ALL" | League)[] = ["ALL", "NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB"];

function statusClass(status: GamePrediction["status"]) {
  if (status === "PROOF PICK") return "pill pill-proof";
  if (status === "EXPERIMENT") return "pill pill-experiment";
  return "pill pill-no-pick";
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  accent
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  accent?: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-card-top">
        <span className={`icon-box ${accent ?? ""}`}><Icon size={18} /></span>
        <span className="stat-detail">{detail}</span>
      </div>
      <strong>{value}</strong>
      <span className="stat-label">{label}</span>
    </article>
  );
}

function MiniGauge({ value, label }: { value: number; label: string }) {
  return (
    <div className="mini-gauge">
      <div className="gauge-ring" style={{ "--value": `${value * 3.6}deg` } as React.CSSProperties}>
        <span>{Math.round(value)}%</span>
      </div>
      <p>{label}</p>
    </div>
  );
}

function GameCard({
  game,
  selected,
  onClick
}: {
  game: GamePrediction;
  selected?: boolean;
  onClick: () => void;
}) {
  const favoriteHome = game.homeWin >= game.awayWin;
  return (
    <button className={`game-card ${selected ? "selected" : ""}`} onClick={onClick}>
      <div className="game-card-head">
        <span className="league-tag">{game.league}</span>
        <span className={statusClass(game.status)}>{game.status}</span>
      </div>
      <div className="matchup">
        <div className={`team-row ${!favoriteHome ? "favored" : ""}`}>
          <span className="team-mark">{game.away.short.slice(0, 2)}</span>
          <div>
            <strong>{game.away.name}</strong>
            <small>{game.away.record}</small>
          </div>
          <span className="win-prob">{game.awayWin}%</span>
        </div>
        <div className={`team-row ${favoriteHome ? "favored" : ""}`}>
          <span className="team-mark">{game.home.short.slice(0, 2)}</span>
          <div>
            <strong>{game.home.name}</strong>
            <small>{game.home.record}</small>
          </div>
          <span className="win-prob">{game.homeWin}%</span>
        </div>
      </div>
      <div className="game-card-foot">
        <span>{game.startLabel}</span>
        <span>Model agree {game.modelAgreement}%</span>
      </div>
    </button>
  );
}

function GameDetail({ game }: { game: GamePrediction }) {
  const selectedTeam = game.homeWin >= game.awayWin ? game.home.name : game.away.name;
  return (
    <section className="panel game-detail">
      <div className="section-head">
        <div>
          <span className="eyebrow">PREDICTION DECOMPOSITION</span>
          <h2>{game.away.name} <span>at</span> {game.home.name}</h2>
        </div>
        <span className={statusClass(game.status)}>{game.status}</span>
      </div>

      <div className="prediction-hero">
        <div className="prediction-pick">
          <span>Sports Eye lean</span>
          <strong>{selectedTeam}</strong>
          <p>{game.confidence} confidence • ±{game.uncertainty}% uncertainty band</p>
        </div>
        <div className="score-box">
          <span>Projected score</span>
          <strong>{game.away.short} {game.predictedAwayScore}</strong>
          <strong>{game.home.short} {game.predictedHomeScore}</strong>
        </div>
        <MiniGauge value={game.modelAgreement} label="model agreement" />
      </div>

      <div className="factor-grid">
        <div>
          <h3>Why the model leans this way</h3>
          <div className="signal-list">
            {game.factorSummary.map((factor) => (
              <div className="signal-row" key={factor}>
                <span className="signal-dot positive" />
                <span>{factor}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3>Risk flags</h3>
          <div className="signal-list">
            {game.riskFlags.map((risk) => (
              <div className="signal-row" key={risk}>
                <span className="signal-dot warning" />
                <span>{risk}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="model-vote-list">
        {game.modelVotes.map((model) => (
          <div className="model-vote" key={model.name}>
            <div>
              <strong>{model.name}</strong>
              <small>{model.status} • weight {model.weight.toFixed(2)}</small>
            </div>
            <div className="model-bar">
              <span style={{ width: `${model.homeWin}%` }} />
            </div>
            <b>{model.homeWin}% home</b>
          </div>
        ))}
      </div>
    </section>
  );
}

function Overview({
  paper,
  selectedGame,
  onSelectGame,
  onRunBatch,
  isRunning,
  autoLearning,
  onToggleAuto
}: {
  paper: PaperState;
  selectedGame: GamePrediction;
  onSelectGame: (game: GamePrediction) => void;
  onRunBatch: () => void;
  isRunning: boolean;
  autoLearning: boolean;
  onToggleAuto: () => void;
}) {
  const totalResults = paper.wins + paper.losses;
  const winRate = totalResults ? (paper.wins / totalResults) * 100 : 0;

  return (
    <>
      <div className="hero-grid">
        <section className="hero-panel">
          <div>
            <span className="eyebrow"><Sparkles size={14} /> SPORTS PREDICTION INTELLIGENCE</span>
            <h1>Analyze every game.<br /><em>Learn from every miss.</em></h1>
            <p>
              Sports Eye separates strict proof from aggressive paper exploration so the system can
              experiment hard without pretending unproven results are real edge.
            </p>
          </div>
          <div className="hero-actions">
            <button className="primary-button" onClick={onRunBatch} disabled={isRunning}>
              {isRunning ? <RefreshCw size={17} className="spin" /> : <Play size={17} />}
              {isRunning ? "Running batch…" : "Run 250 paper trials"}
            </button>
            <button className={`ghost-button auto-button ${autoLearning ? "auto-active" : ""}`} onClick={onToggleAuto}>
              <Zap size={16} />
              {autoLearning ? "Auto exploration ON" : "Start auto exploration"}
            </button>
            <span className="simulation-only"><LockKeyhole size={15} /> Real-money execution locked</span>
          </div>
        </section>

        <section className="brain-status-card">
          <div className="brain-orb"><BrainCircuit size={34} /></div>
          <span className="live-label"><span className="pulse-dot" /> ENGINE READY</span>
          <strong>Sports Brain v0.1</strong>
          <p>Starter simulation engine is active. External live-data providers are not connected yet.</p>
          <div className="brain-metrics">
            <div><span>Mode</span><b>Simulation</b></div>
            <div><span>Data</span><b>Demo</b></div>
            <div><span>Proof</span><b>Locked</b></div>
          </div>
        </section>
      </div>

      <section className="stats-grid">
        <StatCard
          label="Exploration bankroll"
          value={formatMoney(paper.explorationBankroll)}
          detail="paper only"
          icon={CircleDollarSign}
          accent="purple"
        />
        <StatCard
          label="Simulated decisions"
          value={paper.simulatedDecisions.toLocaleString()}
          detail="+250 per batch"
          icon={Zap}
          accent="cyan"
        />
        <StatCard
          label="Simulation win rate"
          value={totalResults ? `${winRate.toFixed(1)}%` : "—"}
          detail={totalResults ? `${paper.wins}W / ${paper.losses}L` : "run a batch"}
          icon={Target}
          accent="green"
        />
        <StatCard
          label="Current Brier score"
          value={paper.brier.toFixed(3)}
          detail="lower is better"
          icon={Gauge}
          accent="orange"
        />
      </section>

      <div className="content-grid">
        <section className="panel slate-panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">DEMO SLATE</span>
              <h2>Games Sports Eye is studying</h2>
            </div>
            <span className="data-tag"><Database size={14} /> synthetic starter data</span>
          </div>
          <div className="game-list">
            {demoGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                selected={game.id === selectedGame.id}
                onClick={() => onSelectGame(game)}
              />
            ))}
          </div>
        </section>

        <section className="panel learning-panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">AGGRESSIVE EXPLORATION</span>
              <h2>Learning loop</h2>
            </div>
            <FlaskConical size={20} />
          </div>
          <div className="learning-loop">
            {["Analyze", "Predict", "Paper bet", "Grade", "Autopsy", "Challenge"].map((step, i) => (
              <div className="loop-step" key={step}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>
          <div className="learning-callout">
            <Zap size={20} />
            <div>
              <strong>Exploration can fail loudly.</strong>
              <p>Its job is to test ideas. Proof Brain stays isolated until a model survives chronological validation.</p>
            </div>
          </div>
          <div className="metric-rows">
            <div><span>Proof-eligible discoveries</span><b>{paper.proofPicks}</b></div>
            <div><span>Calibration error</span><b>{(paper.calibrationError * 100).toFixed(1)}%</b></div>
            <div><span>Last batch</span><b>{paper.lastBatchAt ? "completed" : "not run"}</b></div>
          </div>
        </section>
      </div>

      <GameDetail game={selectedGame} />
    </>
  );
}

function GamesView({
  selectedGame,
  onSelectGame
}: {
  selectedGame: GamePrediction;
  onSelectGame: (game: GamePrediction) => void;
}) {
  const [league, setLeague] = useState<"ALL" | League>("ALL");
  const [query, setQuery] = useState("");
  const filtered = demoGames.filter((game) => {
    const leagueMatch = league === "ALL" || game.league === league;
    const text = `${game.away.name} ${game.home.name} ${game.league}`.toLowerCase();
    return leagueMatch && text.includes(query.toLowerCase());
  });

  return (
    <>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">GAME SCANNER</span>
          <h1>Every matchup, one decision framework.</h1>
          <p>Filter the slate, inspect probability, uncertainty, agreement, and the signals behind each prediction.</p>
        </div>
      </div>

      <div className="toolbar panel">
        <div className="search-box"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search teams…" /></div>
        <div className="league-filters">
          {leagueOptions.map((item) => (
            <button key={item} className={league === item ? "active" : ""} onClick={() => setLeague(item)}>{item}</button>
          ))}
        </div>
      </div>

      <div className="game-browser-grid">
        <div className="game-list tall-list">
          {filtered.map((game) => (
            <GameCard key={game.id} game={game} selected={game.id === selectedGame.id} onClick={() => onSelectGame(game)} />
          ))}
          {!filtered.length && <div className="empty-state">No demo games match this filter.</div>}
        </div>
        <GameDetail game={selectedGame} />
      </div>
    </>
  );
}

function BrainView() {
  const layers = [
    ["Data Brain", "Historical games, live games, players, injuries, weather, odds snapshots, play-by-play", Database],
    ["Feature Brain", "Team strength, player impact, matchup interaction, rest, travel, recency, context", Layers3],
    ["Prediction Brain", "Win probability, score distribution, margin, total, uncertainty", Target],
    ["Proof Brain", "Time-machine testing, sealed holdouts, calibration, drift detection, shadow grading", ShieldCheck],
    ["Mistake Brain", "High-confidence misses, stale data, wrong assumptions, hard-example replay", AlertTriangle],
    ["Model Lab", "Champion/challenger competition with promotion only after proof", FlaskConical]
  ] as const;

  return (
    <>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">SYSTEM ARCHITECTURE</span>
          <h1>Sports Brain</h1>
          <p>The intelligence stack is deliberately split so data collection, prediction, experimentation, and proof cannot contaminate each other.</p>
        </div>
      </div>
      <div className="architecture-grid">
        {layers.map(([name, detail, Icon], index) => (
          <article className="panel architecture-card" key={name}>
            <span className="architecture-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="icon-box"><Icon size={20} /></span>
            <h2>{name}</h2>
            <p>{detail}</p>
            <ChevronRight size={18} />
          </article>
        ))}
      </div>
      <section className="panel architecture-flow">
        <span>COLLECT</span><ChevronRight /><span>ANALYZE</span><ChevronRight /><span>PREDICT</span><ChevronRight />
        <span>SIMULATE</span><ChevronRight /><span>GRADE</span><ChevronRight /><span>LEARN</span><ChevronRight /><span>PROVE</span>
      </section>
    </>
  );
}

function BankrollView({
  paper,
  onRunBatch,
  onReset,
  isRunning
}: {
  paper: PaperState;
  onRunBatch: () => void;
  onReset: () => void;
  isRunning: boolean;
}) {
  const total = paper.wins + paper.losses;
  const winRate = total ? (paper.wins / total) * 100 : 0;
  const pnl = paper.explorationBankroll - 100000;

  return (
    <>
      <div className="page-title-row split-title">
        <div>
          <span className="eyebrow">SIMULATION ACCOUNT</span>
          <h1>Paper Bankroll</h1>
          <p>Destroy fake money if necessary. The point is learning, not making the dashboard look profitable.</p>
        </div>
        <div className="title-actions">
          <button className="ghost-button" onClick={onReset}><RefreshCw size={16} /> Reset</button>
          <button className="primary-button" onClick={onRunBatch} disabled={isRunning}><Play size={16} /> Run 250 trials</button>
        </div>
      </div>

      <section className="bankroll-hero panel">
        <div>
          <span>Exploration bankroll</span>
          <strong>{formatMoney(paper.explorationBankroll)}</strong>
          <p className={pnl >= 0 ? "positive-text" : "negative-text"}>{pnl >= 0 ? "+" : ""}{formatMoney(pnl)} simulated P/L</p>
        </div>
        <div className="bankroll-lock">
          <LockKeyhole size={26} />
          <strong>REAL MONEY LOCKED</strong>
          <span>No sportsbook execution exists in this build.</span>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard label="Trials completed" value={paper.simulatedDecisions.toLocaleString()} detail="synthetic scenarios" icon={Activity} />
        <StatCard label="Win rate" value={total ? `${winRate.toFixed(1)}%` : "—"} detail={total ? `${paper.wins}W / ${paper.losses}L` : "no results"} icon={Target} />
        <StatCard label="Brier score" value={paper.brier.toFixed(3)} detail="probability accuracy" icon={Gauge} />
        <StatCard label="Proof candidates" value={paper.proofPicks.toLocaleString()} detail="not approved picks" icon={ShieldCheck} />
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">WHY TWO ACCOUNTS?</span>
            <h2>Exploration and proof never share standards.</h2>
          </div>
        </div>
        <div className="dual-account-grid">
          <article>
            <span className="pill pill-experiment">EXPLORATION</span>
            <h3>Try dangerous ideas with fake money.</h3>
            <p>New thresholds, features, underdog models, alternative ensembles, and unstable experiments can all run here.</p>
          </article>
          <article>
            <span className="pill pill-proof">PROOF</span>
            <h3>Only accept what survives clean testing.</h3>
            <p>A strategy must pass leakage checks, holdouts, calibration, sufficient sample size, and live shadow grading before promotion.</p>
          </article>
        </div>
      </section>
    </>
  );
}

function ModelsView() {
  return (
    <>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">CHAMPION / CHALLENGER</span>
          <h1>Model Lab</h1>
          <p>No single model gets permanent authority. Challengers keep competing and promotion requires cleaner proof.</p>
        </div>
      </div>
      <div className="model-card-grid">
        {modelCards.map((model) => (
          <article className={`panel model-card ${model.role === "Champion" ? "champion" : ""}`} key={model.name}>
            <div className="model-title">
              <div>
                <span className={model.role === "Champion" ? "pill pill-proof" : "pill pill-experiment"}>{model.role}</span>
                <h2>{model.name}</h2>
              </div>
              <span>{model.version}</span>
            </div>
            <p>{model.note}</p>
            <div className="model-stat-grid">
              <div><span>Brier</span><strong>{model.brier.toFixed(3)}</strong></div>
              <div><span>Log loss</span><strong>{model.logLoss.toFixed(3)}</strong></div>
              <div><span>Cal. error</span><strong>{(model.calibrationError * 100).toFixed(1)}%</strong></div>
              <div><span>Score MAE</span><strong>{model.scoreMae.toFixed(1)}</strong></div>
            </div>
            <small>{model.sampleSize.toLocaleString()} demo evaluation rows</small>
          </article>
        ))}
      </div>
      <section className="panel promotion-rule">
        <ShieldCheck size={24} />
        <div>
          <h3>Promotion gate</h3>
          <p>A challenger cannot replace the champion because of one hot streak. It must improve out-of-sample probability quality without degrading calibration or failing the recent holdout.</p>
        </div>
      </section>
    </>
  );
}

function MistakesView() {
  return (
    <>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">POSTGAME AUTOPSY</span>
          <h1>Mistake Lab</h1>
          <p>Wrong predictions become training cases. High-confidence failures get the most attention.</p>
        </div>
      </div>
      <div className="mistake-list">
        {mistakeCases.map((item) => (
          <article className="panel mistake-card" key={item.id}>
            <div className="mistake-head">
              <div>
                <span className={`severity ${item.severity.toLowerCase()}`}>{item.severity}</span>
                <span className="league-tag">{item.league}</span>
              </div>
              <strong>{item.confidence}% confidence miss</strong>
            </div>
            <h2>{item.title}</h2>
            <div className="mistake-result">
              <span>Prediction <b>{item.predicted}</b></span>
              <ChevronRight size={16} />
              <span>Result <b>{item.result}</b></span>
            </div>
            <div className="autopsy-grid">
              <div>
                <span>ROOT CAUSE</span>
                <p>{item.rootCause}</p>
              </div>
              <div>
                <span>LESSON ADDED</span>
                <p>{item.lesson}</p>
              </div>
            </div>
            <div className="tag-row">{item.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
          </article>
        ))}
      </div>
    </>
  );
}

function ProofView() {
  return (
    <>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">EVIDENCE BEFORE CONFIDENCE</span>
          <h1>Proof Wall</h1>
          <p>This is where Sports Eye proves whether its probabilities mean anything. Demo numbers cannot unlock real-money execution.</p>
        </div>
      </div>
      <div className="proof-list">
        {proofMetrics.map((metric) => (
          <article className="panel proof-row" key={metric.label}>
            <span className={`proof-status ${metric.status}`}>
              {metric.status === "pass" ? <ShieldCheck size={19} /> : metric.status === "watch" ? <Gauge size={19} /> : <LockKeyhole size={19} />}
            </span>
            <div>
              <h3>{metric.label}</h3>
              <p>{metric.detail}</p>
            </div>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>
      <section className="panel calibration-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">CALIBRATION TARGET</span>
            <h2>When Sports Eye says 70%, it should happen about 70% of the time.</h2>
          </div>
        </div>
        <div className="calibration-bars">
          {[
            ["50–59%", 54, 52],
            ["60–69%", 64, 63],
            ["70–79%", 74, 72],
            ["80–89%", 84, 81],
            ["90–100%", 92, 88]
          ].map(([bucket, predicted, actual]) => (
            <div className="calibration-row" key={String(bucket)}>
              <span>{bucket}</span>
              <div className="calibration-track">
                <span className="predicted" style={{ width: `${predicted}%` }} />
                <span className="actual" style={{ width: `${actual}%` }} />
              </div>
              <b>{actual}% actual</b>
            </div>
          ))}
        </div>
        <small className="demo-note">Illustrative calibration display only until historical feeds are connected.</small>
      </section>
    </>
  );
}

export default function SportsEyeApp() {
  const [view, setView] = useState<View>("overview");
  const [selectedGame, setSelectedGame] = useState<GamePrediction>(demoGames[0]);
  const [paper, setPaper] = useState<PaperState>(() => createInitialPaperState());
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [autoLearning, setAutoLearning] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("sports-eye-paper-v1");
    if (saved) {
      try {
        setPaper(JSON.parse(saved));
      } catch {
        setPaper(createInitialPaperState());
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      window.localStorage.setItem("sports-eye-paper-v1", JSON.stringify(paper));
    }
  }, [paper, hydrated]);

  useEffect(() => {
    if (!autoLearning) return;
    const timer = window.setInterval(() => {
      setPaper((current) => runExplorationBatch(current, 250));
    }, 1400);
    return () => window.clearInterval(timer);
  }, [autoLearning]);

  const activeLabel = useMemo(() => navItems.find((item) => item.key === view)?.label ?? "Sports Eye", [view]);

  const runBatch = () => {
    setIsRunning(true);
    window.setTimeout(() => {
      setPaper((current) => runExplorationBatch(current, 250));
      setIsRunning(false);
    }, 550);
  };

  const reset = () => setPaper(resetPaperState());

  const chooseView = (next: View) => {
    setView(next);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Target size={25} /></div>
          <div><strong>SPORTS EYE</strong><span>Prediction Intelligence</span></div>
        </div>
        <nav>
          {navItems.map(({ key, label, icon: Icon }) => (
            <button key={key} className={view === key ? "active" : ""} onClick={() => chooseView(key)}>
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="system-chip"><span className="pulse-dot" /> Engine online</div>
          <p>Simulation build v0.1</p>
          <p>No live provider connected</p>
        </div>
      </aside>

      {menuOpen && <button className="mobile-scrim" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}

      <main className="main">
        <header className="topbar">
          <div className="mobile-brand-row">
            <button className="menu-button" onClick={() => setMenuOpen((v) => !v)}>{menuOpen ? <X /> : <Menu />}</button>
            <span>{activeLabel}</span>
          </div>
          <div className="topbar-data-warning">
            <Database size={15} />
            <span>Demo data mode</span>
          </div>
          <div className="topbar-right">
            <span className="proof-lock"><LockKeyhole size={15} /> Proof locked</span>
            <div className="avatar">SE</div>
          </div>
        </header>

        <div className="page">
          {view === "overview" && (
            <Overview
              paper={paper}
              selectedGame={selectedGame}
              onSelectGame={setSelectedGame}
              onRunBatch={runBatch}
              isRunning={isRunning}
              autoLearning={autoLearning}
              onToggleAuto={() => setAutoLearning((value) => !value)}
            />
          )}
          {view === "games" && <GamesView selectedGame={selectedGame} onSelectGame={setSelectedGame} />}
          {view === "brain" && <BrainView />}
          {view === "bankroll" && <BankrollView paper={paper} onRunBatch={runBatch} onReset={reset} isRunning={isRunning} />}
          {view === "models" && <ModelsView />}
          {view === "mistakes" && <MistakesView />}
          {view === "proof" && <ProofView />}
        </div>
      </main>
    </div>
  );
}
