import React, { useMemo } from "react";
import "./simulation.css";

/* Layered, CSS-only forest atmosphere (no canvas / WebGL, no external images):
   gradient + grid + canopy shadows + fog + two SVG tree-line silhouettes +
   drifting particles + a handful of fireflies + a very slow radar sweep.
   ~30 static DOM nodes; every animation is transform/opacity. */

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function skyline(seed, base, minH, maxH, step) {
  const rnd = seeded(seed);
  let d = `M0 100 L0 ${100 - base}`;
  for (let x = 0; x <= 1000; x += step) {
    const h = base + minH + rnd() * (maxH - minH);
    // conifer: narrow spike between two shoulders
    d += ` L${x} ${100 - base - (h - base) * 0.35} L${x + step * 0.5} ${100 - h} L${x + step} ${100 - base - (h - base) * 0.35}`;
  }
  return `${d} L1000 100 Z`;
}

export default function ForestBackground() {
  const back = useMemo(() => skyline(11, 18, 8, 40, 26), []);
  const front = useMemo(() => skyline(29, 8, 6, 30, 34), []);
  const particles = useMemo(() => {
    const r = seeded(5);
    return Array.from({ length: 16 }, (_, i) => ({
      i, left: `${r() * 100}%`, top: `${45 + r() * 55}%`, dur: 16 + r() * 18, delay: -r() * 30, dx: `${(r() - 0.5) * 80}px`,
    }));
  }, []);
  const flies = useMemo(() => {
    const r = seeded(9);
    return Array.from({ length: 7 }, (_, i) => ({
      i, left: `${8 + r() * 84}%`, top: `${52 + r() * 40}%`, dur: 7 + r() * 8, delay: -r() * 12,
      fx: `${(r() - 0.5) * 60}px`, fy: `${-8 - r() * 30}px`,
    }));
  }, []);

  return (
    <div className="kv-forest-bg" aria-hidden="true">
      <div className="kv-grid" />
      <div className="kv-radar-bg" />
      <div className="kv-canopy c1" /><div className="kv-canopy c2" /><div className="kv-canopy c3" />
      <div className="kv-fog f2" /><div className="kv-fog f1" />
      <svg className="kv-treeline back" viewBox="0 0 1000 100" preserveAspectRatio="none"><path d={back} fill="#0F2419" /></svg>
      <svg className="kv-treeline front" viewBox="0 0 1000 100" preserveAspectRatio="none"><path d={front} fill="#070F0A" /></svg>
      {particles.map((p) => (
        <span key={p.i} className="kv-particle"
          style={{ left: p.left, top: p.top, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`, "--dx": p.dx }} />
      ))}
      {flies.map((f) => (
        <span key={f.i} className="kv-firefly"
          style={{ left: f.left, top: f.top, animationDuration: `${f.dur}s`, animationDelay: `${f.delay}s`, "--fx": f.fx, "--fy": f.fy }} />
      ))}
    </div>
  );
}
