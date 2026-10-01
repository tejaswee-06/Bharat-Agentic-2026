import React from "react";
import { X, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { riskVar, RiskBadge } from "../KavachApp.jsx";
import { fmtTime } from "./SimulationContext.jsx";
import "./simulation.css";

const STATE_LABEL = {
  foraging: "Moving", following: "Moving (herd)", resting: "Resting",
  edge_approach: "Approaching boundary", edge_hold: "Holding at boundary",
};
const ICONS = { TIGER: "🐅", ELEPHANT: "🐘", LEOPARD: "🐆", WILDBOAR: "🐗", DEER: "🦌" };

function Cell({ label, value, color }) {
  return (
    <div style={{ background: "var(--panel-raised)", border: "1px solid var(--line-soft)", borderRadius: 3, padding: "8px 10px", minWidth: 0 }}>
      <div className="kv-mono" style={{ fontSize: 9.5, color: "var(--text-dim)", marginBottom: 3, letterSpacing: ".06em" }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color, overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

export function Sparkline({ values, color = "var(--gold)", w = 280, h = 44, fill = true }) {
  if (!values || values.length < 2) return <div className="kv-mono" style={{ fontSize: 10, color: "var(--text-dim)" }}>collecting data…</div>;
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / span) * (h - 8)]);
  const line = pts.map((p) => p.join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="trend chart">
      {fill && <polygon points={`2,${h} ${line} ${w - 2},${h}`} fill={color} opacity=".12" />}
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill={color} />
    </svg>
  );
}

/* Mini "timeline" of the recent trail, drawn in local km-scaled coordinates. */
function TrailMini({ trail, color }) {
  if (!trail || trail.length < 2) return <div className="kv-mono" style={{ fontSize: 10, color: "var(--text-dim)" }}>collecting data…</div>;
  const w = 280, h = 70;
  const lat0 = trail[0][0], kx = Math.cos((lat0 * Math.PI) / 180);
  const xy = trail.map((t) => [t[1] * kx, -t[0]]);
  const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = Math.min((w - 12) / Math.max(1e-6, maxX - minX), (h - 12) / Math.max(1e-6, maxY - minY));
  const P = xy.map(([x, y]) => [6 + (x - minX) * s, 6 + (y - minY) * s]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="recent movement path">
      {P.slice(1).map((p, i) => (
        <line key={i} x1={P[i][0]} y1={P[i][1]} x2={p[0]} y2={p[1]} stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" opacity={0.15 + 0.85 * ((i + 1) / P.length)} />
      ))}
      <circle cx={P[P.length - 1][0]} cy={P[P.length - 1][1]} r="4.5" fill={color} stroke="#E6EFDD" strokeWidth="1.2" />
    </svg>
  );
}

export function AnimalPanel({ feature, onClose, onFocus }) {
  if (!feature) return null;
  const p = feature.properties;
  const color = riskVar(p.risk_level);
  return (
    <div className="kv-panel kv-slidein" style={{ padding: 18 }} aria-live="polite">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div className="kv-display" style={{ fontSize: 20, fontWeight: 700, letterSpacing: ".08em" }}>
            {ICONS[p.species_code] || "🐾"} {p.species.toUpperCase()}
          </div>
          <div className="kv-mono" style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{p.animal_id}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="kv-sim-tag">SIMULATED</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: "var(--text-dim)" }}><X size={16} /></button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
        <div className="kv-display" style={{ fontSize: 32, fontWeight: 700, color }}>{Math.round(p.risk_score)}%</div>
        <RiskBadge level={p.risk_level} />
      </div>

      <div className="kv-detail-grid">
        <Cell label="Status" value={STATE_LABEL[p.state] || p.state} />
        <Cell label="Speed" value={`${Number(p.speed).toFixed(1)} km/h`} />
        <Cell label="Location" value={p.protected_area} />
        <Cell label="Heading" value={`${p.compass} · ${Math.round(p.heading)}°`} />
        <Cell label="Last detected" value={fmtTime(p.last_seen)} />
        <Cell label="Detections" value={p.detections} />
        <Cell label="To boundary" value={`${Number(p.boundary_km).toFixed(1)} km`} color={p.boundary_km < 1.5 ? "var(--high)" : undefined} />
        <Cell label="To settlement*" value={`${Number(p.settlement_km).toFixed(1)} km`} />
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="kv-mono" style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4, letterSpacing: ".08em" }}>RECENT MOVEMENT</div>
        <TrailMini trail={p.trail} color={color} />
        <div className="kv-mono" style={{ fontSize: 10, color: "var(--text-dim)", margin: "8px 0 2px", letterSpacing: ".08em" }}>RISK TIMELINE</div>
        <Sparkline values={p.risk_history} color={color} />
      </div>
      <button className="kv-btn" style={{ width: "100%", justifyContent: "center", marginTop: 12, fontSize: 11 }} onClick={onFocus}>CENTER ON ANIMAL</button>
      <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 10, lineHeight: 1.5 }}>
        SIMULATION DATA · movement is a demonstration model, not a claim about real animal behaviour. *Settlement is a synthetic input.
      </div>
    </div>
  );
}

export function HotspotPanel({ feature, onClose }) {
  if (!feature) return null;
  const p = feature.properties;
  const color = riskVar(p.risk_level);
  const dir = p.trend_dir;
  const TrendIcon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  const trendText = dir === "up" ? "Increasing" : dir === "down" ? "Decreasing" : dir === "flat" ? "Stable" : "—";
  return (
    <div className="kv-panel kv-slidein" style={{ padding: 18 }} aria-live="polite">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div className="kv-mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>RISK HOTSPOT #{p.id}</div>
          <div className="kv-display" style={{ fontSize: 19, fontWeight: 700 }}>{p.protected_area_name || "Unresolved area"}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {p.source === "simulation" && <span className="kv-sim-tag">SIMULATED</span>}
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: "var(--text-dim)" }}><X size={16} /></button>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
        <div className="kv-display" style={{ fontSize: 34, fontWeight: 700, color }}>{Math.round(p.risk_score)}%</div>
        <RiskBadge level={p.risk_level} />
      </div>
      <div className="kv-detail-grid">
        <Cell label="Detections" value={p.detection_count} />
        <Cell label="Primary species" value={p.species} />
        <Cell label="Last updated" value={fmtTime(p.updated_at)} />
        <Cell label="Trend" value={<span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: dir === "up" ? "var(--high)" : undefined }}><TrendIcon size={14} /> {trendText}</span>} />
      </div>
      {p.trend && (
        <div style={{ marginTop: 14 }}>
          <div className="kv-mono" style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 2, letterSpacing: ".08em" }}>RISK SCORE TREND</div>
          <Sparkline values={p.trend} color={color} />
        </div>
      )}
    </div>
  );
}
