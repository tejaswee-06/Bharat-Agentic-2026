import React, { useEffect, useState } from "react";
import { useSim, fmtTime } from "./SimulationContext.jsx";
import { simStateLabel } from "./SimControlPanel.jsx";
import { riskVar } from "../KavachApp.jsx";
import "./simulation.css";

function Pill({ tone, children }) {
  return (
    <span className="kv-tag" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span className={`kv-live-dot ${tone}`} />{children}
    </span>
  );
}

/* Hero identity + status pills + live stat tiles.
 * Every number comes from the backend simulation status (nothing hardcoded). */
export default function SimCommandStrip() {
  const { status, link } = useSim();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {              // one 1 s interval for the wall clock, cleaned up on unmount
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const state = simStateLabel(link, status);
  const gisTone = !status ? "bad" : status.mode === "postgis" ? "on" : "warn";
  const gisText = !status ? "BACKEND OFFLINE" : status.mode === "postgis" ? "GIS CONNECTED" : "GIS OFFLINE · SIMULATION LOCAL";
  const simTone = !status ? "bad" : status.running ? "on" : "warn";
  const aiTone = !status ? "bad" : status.risk_source === "ml_model" ? "on" : "warn";
  const aiText = !status ? "AI OFFLINE" : status.risk_source === "ml_model" ? "AI ONLINE" : "AI FALLBACK · ANALYTIC";
  const ld = status && status.last_detection;

  const tiles = [
    ["LIVE TIME", now.toLocaleTimeString([], { hour12: false })],
    ["EVENTS / SEC", status ? status.events_per_sec.toFixed(2) : "—"],
    ["ACTIVE ANIMALS", status ? status.animals_active : "—"],
    ["ACTIVE HOTSPOTS", status ? status.hotspots_active : "—"],
    ["HIGH-RISK ZONES", status ? status.high_risk_zones : "—"],
  ];

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="kv-hero-title kv-display">KAVACH</div>
      <div className="kv-hero-sub">WILDLIFE INTELLIGENCE COMMAND CENTER</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, alignItems: "center" }}>
        <Pill tone={gisTone}>{gisText}</Pill>
        <Pill tone={simTone}>{status ? `SIMULATION ${state}` : state}</Pill>
        <Pill tone={aiTone}>{aiText}</Pill>
        <span className="kv-sim-tag">SIMULATION DATA</span>
      </div>
      <div className="kv-stat-grid">
        {tiles.map(([k, v]) => (
          <div className="kv-stat" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>
        ))}
        <div className="kv-stat" style={{ gridColumn: "span 2", minWidth: 0 }}>
          <div className="k">LAST DETECTION</div>
          <div className="v" style={{ fontSize: 15, lineHeight: 1.35, whiteSpace: "normal" }}>
            {ld ? (
              <>
                {ld.species} · {ld.protected_area} ·{" "}
                <span style={{ color: riskVar(ld.risk_level) }}>{Math.round(ld.risk_score)}% {ld.risk_level}</span>{" "}
                <span className="kv-mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{fmtTime(ld.timestamp)}</span>
              </>
            ) : (
              <span style={{ color: "var(--text-dim)" }}>none yet</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
