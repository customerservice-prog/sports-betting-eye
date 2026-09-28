"use client";

import { Database, Radio, RefreshCw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type LiveGame = {
  id: string;
  league: string;
  startsAt: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbreviation: string;
  awayAbbreviation: string;
  homeRecord: string;
  awayRecord: string;
  venue: string;
  status: "scheduled" | "live" | "final";
  statusDetail: string;
  homeScore: number | null;
  awayScore: number | null;
};

function localStart(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  }).format(new Date(iso));
}

export default function LiveGamesPanel({ compact = false }: { compact?: boolean }) {
  const [games, setGames] = useState<LiveGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceError, setSourceError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/games?pastHours=18&futureHours=120&limit=100", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load games");
      setGames(payload.games ?? []);
      setSourceError("");
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Unable to load real games.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const shown = compact ? games.slice(0, 8) : games;

  return (
    <section className="panel real-games-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow"><Radio size={13} /> REAL SPORTS FEED</span>
          <h2>Actual schedules & results</h2>
        </div>
        <button className="feed-refresh" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
        </button>
      </div>

      <div className="source-disclaimer">
        <Database size={15} />
        <span>ESPN public scoreboard • real game data • unofficial endpoint</span>
        <span className="proof-source-warning"><ShieldAlert size={14} /> not proof-grade model history</span>
      </div>

      {sourceError && <div className="feed-error">{sourceError}</div>}
      {!sourceError && !loading && shown.length === 0 && (
        <div className="empty-state">Database connected. Waiting for the ingestion worker to store the current slate.</div>
      )}

      <div className="real-game-grid">
        {shown.map((game) => (
          <article className={`real-game-card ${game.status}`} key={game.id}>
            <div className="real-game-head">
              <span className="league-tag">{game.league}</span>
              <span className={`feed-status ${game.status}`}>
                {game.status === "live" ? "LIVE" : game.status === "final" ? "FINAL" : "SCHEDULED"}
              </span>
            </div>

            <div className="real-team-row">
              <span className="team-mark">{game.awayAbbreviation.slice(0, 3)}</span>
              <div><strong>{game.awayTeam}</strong><small>{game.awayRecord || "record unavailable"}</small></div>
              <b>{game.awayScore ?? "—"}</b>
            </div>
            <div className="real-team-row">
              <span className="team-mark">{game.homeAbbreviation.slice(0, 3)}</span>
              <div><strong>{game.homeTeam}</strong><small>{game.homeRecord || "record unavailable"}</small></div>
              <b>{game.homeScore ?? "—"}</b>
            </div>

            <div className="real-game-meta">
              <span>{game.statusDetail || localStart(game.startsAt)}</span>
              {game.venue && <span>{game.venue}</span>}
            </div>
            <div className="model-pending">MODEL: PENDING REAL TRAINING</div>
          </article>
        ))}
      </div>

      {compact && games.length > shown.length && (
        <div className="feed-more">{games.length - shown.length} more real games stored in Sports Eye</div>
      )}
    </section>
  );
}
