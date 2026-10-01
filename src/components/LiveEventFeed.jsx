import React from "react";
import { Radio } from "lucide-react";
import { RiskBadge, riskVar } from "../KavachApp.jsx";
import { useSim, fmtTime } from "../gis/SimulationContext.jsx";
import "../gis/simulation.css";

function headline(e) {
  const sp = (e.species || "").toUpperCase();
  if (e.event_type === "ALERT") return `⚠ HIGH-RISK · ${sp}`;
  if (e.event_type === "BOUNDARY") return `${sp} movement`;
  return `${sp} detected`;
}

/* Newest-first, bounded (server buffer 25/tick, client keeps 60, we render `limit`). */
export default function LiveEventFeed({ limit = 8, onSelect, title = "LIVE WILDLIFE EVENTS" }) {
  const { events, status, link } = useSim();
  const rows = events.slice(0, limit);
  return (
    <div className="kv-panel kv-feed" aria-label="Live wildlife events">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Radio size={13} color="var(--gold)" /> {title}
        </h3>
        <span className="kv-sim-tag">SIMULATED</span>
      </div>
      <div className="kv-feed-list kv-scroll-thin" role="log" aria-live="off">
        {rows.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "10px 2px", lineHeight: 1.5 }}>
            {!status
              ? (link === "offline" ? "Backend not reachable — events will appear once it is running." : "Connecting to simulation…")
              : status.tick === 0
                ? "Simulation ready. Press START to begin streaming wildlife events."
                : "Waiting for the next event…"}
          </div>
        )}
        {rows.map((e) => {
          const Tag = onSelect ? "button" : "div";
          return (
            <Tag key={e.seq} type={onSelect ? "button" : undefined}
              className={`kv-feed-item ${e.event_type === "ALERT" ? "alert" : ""}`}
              style={{ borderLeftColor: riskVar(e.risk_level), cursor: onSelect ? "pointer" : "default" }}
              onClick={onSelect ? () => onSelect(e) : undefined}>
              <span className="tm">{fmtTime(e.timestamp)}</span>
              <span>
                <div className="hd">{headline(e)}</div>
                <div className="sb">{e.protected_area} · Risk {Math.round(e.risk_score)}%</div>
              </span>
              <RiskBadge level={e.risk_level} size="sm" />
            </Tag>
          );
        })}
      </div>
    </div>
  );
}
