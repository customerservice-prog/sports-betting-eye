"use client";

import { Activity, Database, FileClock, HeartPulse, PackageOpen, ShieldCheck, Users, UserRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Coverage = {
  database?: {
    counts?: {
      games?: number;
      predictions?: number;
      grades?: number;
      mistakes?: number;
      explorationBatches?: number;
    };
  };
  knowledge?: {
    teams?: number;
    players?: number;
    rosterSnapshots?: number;
    injuries?: number;
    transactions?: number;
    contextSnapshots?: number;
    featureSnapshots?: number;
    gamePackages?: number;
  };
};

const number = (value?: number) => (value ?? 0).toLocaleString();

export default function DataCoveragePanel() {
  const [data, setData] = useState<Coverage | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/system/status", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Coverage unavailable");
      setData(payload);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Coverage unavailable");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const counts = data?.database?.counts;
  const knowledge = data?.knowledge;

  const cards = [
    ["Games", number(counts?.games), "historical + current", Database],
    ["Teams", number(knowledge?.teams), "team identities", ShieldCheck],
    ["Players", number(knowledge?.players), "player profiles", UserRound],
    ["Roster snapshots", number(knowledge?.rosterSnapshots), "who was on each team", Users],
    ["Injury records", number(knowledge?.injuries), "availability context", HeartPulse],
    ["Game packages", number(knowledge?.gamePackages), "boxscore + play detail", PackageOpen],
    ["Pregame snapshots", number(knowledge?.featureSnapshots), "frozen before prediction", FileClock],
    ["Graded predictions", number(counts?.grades), "real evidence", Activity]
  ] as const;

  return (
    <section className="panel coverage-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow"><Database size={13} /> SPORTS EYE MEMORY</span>
          <h2>What the system actually knows</h2>
        </div>
        <span className="coverage-source">Postgres • refreshes automatically</span>
      </div>

      {error ? (
        <div className="feed-error">{error}</div>
      ) : (
        <div className="coverage-grid">
          {cards.map(([label, value, detail, Icon]) => (
            <article className="coverage-card" key={label}>
              <Icon size={17} />
              <strong>{value}</strong>
              <span>{label}</span>
              <small>{detail}</small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
