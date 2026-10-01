import React from "react";
import { Play, Pause, RotateCcw } from "lucide-react";
import { useSim } from "./SimulationContext.jsx";
import "./simulation.css";

const SPEEDS = [0.5, 1, 2, 5];

/* Human-readable link/pipeline state, derived only from real backend state. */
export function simStateLabel(link, status) {
  if (!status) return link === "offline" ? "BACKEND OFFLINE" : "CONNECTING";
  if (status.running) return "LIVE";
  return status.tick > 0 ? "PAUSED" : "READY";
}

export default function SimControlPanel({ compact = false }) {
  const { status, link, busy, controls } = useSim();
  const state = simStateLabel(link, status);
  const running = !!(status && status.running);
  const offline = !status;
  const dot = running ? "on" : offline ? "bad" : "warn";

  return (
    <div className="kv-panel kv-sim-panel" aria-label="Simulation controls">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h3>SIMULATION</h3>
        <span className="kv-sim-tag">SIMULATION DATA</span>
      </div>
      <div className="kv-mono" style={{ margin: "10px 0 8px", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <span className={`kv-live-dot ${dot}`} /> <b>{state}</b>
        {status && <span style={{ color: "var(--text-dim)" }}>· sim clock {status.sim_clock}</span>}
      </div>

      {offline ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Simulation API not reachable. Start the backend:<br />
          <code className="kv-mono">uvicorn predict:app --reload --port 8000</code>
        </div>
      ) : (
        <div>
          <div className="kv-sim-row"><span>Animals</span><b>{status.animals_active}<span style={{ color: "var(--text-dim)" }}> / {status.animals_total}</span></b></div>
          <div className="kv-sim-row"><span>Events</span><b>{status.events_total}</b></div>
          <div className="kv-sim-row"><span>Hotspots</span><b>{status.hotspots_active}</b></div>
          <div className="kv-sim-row"><span>High risk zones</span><b style={{ color: status.high_risk_zones ? "var(--high)" : undefined }}>{status.high_risk_zones}</b></div>
          {!compact && (
            <div className="kv-sim-row"><span>Pipeline</span>
              <b style={{ fontSize: 10.5 }}>{status.mode === "postgis" ? "POSTGIS" : "LOCAL MEMORY"} · {status.risk_source === "ml_model" ? "ML MODEL" : "ANALYTIC"}</b>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        {running ? (
          <button className="kv-btn" style={{ fontSize: 11, padding: "8px 12px" }} disabled={busy || offline} onClick={controls.pause}>
            <Pause size={13} /> PAUSE
          </button>
        ) : (
          <button className="kv-btn kv-btn-primary" style={{ fontSize: 11, padding: "8px 12px" }} disabled={busy || offline} onClick={controls.start}>
            <Play size={13} /> {status && status.tick > 0 ? "RESUME" : "START"}
          </button>
        )}
        <button className="kv-btn" style={{ fontSize: 11, padding: "8px 12px" }} disabled={busy || offline} onClick={controls.reset}>
          <RotateCcw size={13} /> RESET
        </button>
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="kv-mono" style={{ fontSize: 10, color: "var(--text-dim)", letterSpacing: ".08em" }}>SPEED</span>
        <div className="kv-speed" role="group" aria-label="Simulation speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" aria-pressed={status ? status.speed === s : s === 1}
              disabled={busy || offline} onClick={() => controls.setSpeed(s)}>{s}x</button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 10, lineHeight: 1.5 }}>
        Synthetic demonstration data. Controls never touch the real YOLO pipeline (<span className="kv-mono">/predict</span>, <span className="kv-mono">/risk</span>).
      </div>
    </div>
  );
}
