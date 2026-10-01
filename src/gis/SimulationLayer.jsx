import { useEffect, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import "./simulation.css";

/* ------------------------------------------------------------------
 * Imperative Leaflet layer for the simulated wildlife:
 *   - one custom HTML marker per animal (created once, then mutated)
 *   - smooth A -> B interpolation driven by a single requestAnimationFrame loop
 *   - a fading 3-segment movement trail per animal (bounded server-side)
 *   - one-shot radar pulses for new detections (auto-removed)
 * React never re-renders per frame: all per-frame work happens on refs.
 * ---------------------------------------------------------------- */

const ICONS = { TIGER: "🐅", ELEPHANT: "🐘", LEOPARD: "🐆", WILDBOAR: "🐗", DEER: "🦌" };
const LEVEL_COLOR = { LOW: "#4F8A64", MEDIUM: "#D99A32", HIGH: "#C94C4C" };
const TRAIL_COLOR = "#D6A84F";
const MAX_PULSES = 12;
const PULSE_MS = 3200;

const reduceMotion = () =>
  typeof document !== "undefined" &&
  (document.documentElement.getAttribute("data-reduce-motion") === "true" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

function markerHTML(p) {
  return `<div class="kv-animal" tabindex="0" role="button" aria-label="${p.species} ${p.animal_id}">
    <div class="kv-animal-arrow"></div>
    <div class="kv-animal-disc">${ICONS[p.species_code] || "🐾"}</div>
    <div class="kv-animal-label"></div>
  </div>`;
}

function split3(pts) {
  const n = pts.length;
  if (n < 2) return [[], [], pts];
  const a = Math.max(1, Math.floor(n / 3)), b = Math.max(a + 1, Math.floor((2 * n) / 3));
  return [pts.slice(0, a + 1), pts.slice(a, b + 1), pts.slice(b)];
}

export default function SimulationLayer({
  animals,            // GeoJSON FeatureCollection (already filtered)
  intervalMs,         // expected time between server ticks
  running,
  pulses,             // [{ id, lat, lng, level }]
  selectedId,
  onSelect,
  showTrails = true,
}) {
  const map = useMap();
  const store = useRef(new Map());          // id -> record
  const pulseSeen = useRef(new Set());
  const pulseLive = useRef(new Map());      // id -> { marker, timer }
  const rafRef = useRef(0);
  const cbRef = useRef({ onSelect });
  cbRef.current.onSelect = onSelect;
  const intervalRef = useRef(intervalMs);
  intervalRef.current = intervalMs;
  const trailsRef = useRef(showTrails);
  trailsRef.current = showTrails;

  /* label visibility follows zoom (CSS hook on the map container) */
  useEffect(() => {
    const el = map.getContainer();
    const sync = () => el.classList.toggle("kv-zoomed-in", map.getZoom() >= 8);
    sync();
    map.on("zoomend", sync);
    return () => { map.off("zoomend", sync); el.classList.remove("kv-zoomed-in"); };
  }, [map]);

  /* ---- animal records: create / update / remove ---- */
  useEffect(() => {
    const feats = animals?.features || [];
    const seen = new Set();
    const now = performance.now();

    feats.forEach((f) => {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      seen.add(p.animal_id);
      let rec = store.current.get(p.animal_id);
      if (!rec) {
        const icon = L.divIcon({ className: "kv-animal-wrap", html: markerHTML(p), iconSize: [36, 36], iconAnchor: [18, 18] });
        const marker = L.marker([lat, lng], { icon, keyboard: false, zIndexOffset: 800 }).addTo(map);
        const el = marker.getElement();
        const root = el.querySelector(".kv-animal");
        rec = {
          id: p.animal_id, marker, root,
          arrow: root.querySelector(".kv-animal-arrow"),
          label: root.querySelector(".kv-animal-label"),
          from: [lat, lng], to: [lat, lng], cur: [lat, lng], t0: now, dur: 1,
          trail: [L.polyline([], { className: "kv-trail", color: TRAIL_COLOR, weight: 2, opacity: 0.18, interactive: false }).addTo(map),
                  L.polyline([], { className: "kv-trail", color: TRAIL_COLOR, weight: 2.4, opacity: 0.38, interactive: false }).addTo(map),
                  L.polyline([], { className: "kv-trail", color: TRAIL_COLOR, weight: 3, opacity: 0.7, interactive: false }).addTo(map)],
          tail: [],
        };
        const open = () => cbRef.current.onSelect && cbRef.current.onSelect(p.animal_id);
        root.addEventListener("click", open);
        root.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
        L.DomEvent.disableClickPropagation(el);
        store.current.set(p.animal_id, rec);
      } else {
        // continue from where the marker visually is now
        rec.from = rec.cur.slice();
        rec.to = [lat, lng];
        rec.t0 = now;
        rec.dur = reduceMotion() ? 1 : Math.max(400, Math.min(4500, intervalRef.current || 3000)) * 0.97;
      }

      const color = LEVEL_COLOR[p.risk_level] || LEVEL_COLOR.LOW;
      rec.root.style.setProperty("--kv-c", color);
      rec.root.classList.toggle("high", p.risk_level === "HIGH");
      rec.arrow.style.transform = `rotate(${p.heading}deg)`;
      rec.label.textContent = `${p.species_code}-${p.animal_id.slice(-3)} · ${Math.round(p.risk_score)}`;
      rec.root.setAttribute("aria-label", `${p.species} ${p.animal_id}, ${p.risk_level} risk ${Math.round(p.risk_score)} percent`);

      // trail: static chunks for the older points, the newest chunk is extended to
      // the interpolated position every frame.
      const pts = (p.trail || []).map((t) => [t[0], t[1]]);
      const [c1, c2, c3] = split3(pts);
      rec.trail[0].setLatLngs(c1);
      rec.trail[1].setLatLngs(c2);
      rec.tail = c3;
      rec.trail.forEach((t) => t.setStyle({ color: TRAIL_COLOR }));
    });

    // animals that vanished (reset / filter)
    store.current.forEach((rec, id) => {
      if (!seen.has(id)) {
        rec.marker.remove();
        rec.trail.forEach((t) => t.remove());
        store.current.delete(id);
      }
    });
  }, [animals, map]);

  /* ---- selection highlight ---- */
  useEffect(() => {
    store.current.forEach((rec, id) => rec.root.classList.toggle("sel", id === selectedId));
  }, [selectedId, animals]);

  /* ---- single rAF loop ---- */
  useEffect(() => {
    let alive = true;
    const frame = (t) => {
      if (!alive) return;
      store.current.forEach((rec) => {
        const k = rec.dur > 0 ? Math.min(1, (t - rec.t0) / rec.dur) : 1;
        const lat = rec.from[0] + (rec.to[0] - rec.from[0]) * k;
        const lng = rec.from[1] + (rec.to[1] - rec.from[1]) * k;
        if (lat !== rec.cur[0] || lng !== rec.cur[1]) {
          rec.cur = [lat, lng];
          rec.marker.setLatLng(rec.cur);
          if (trailsRef.current) {
            rec.trail[2].setLatLngs(rec.tail.length ? [...rec.tail, rec.cur] : [rec.cur]);
          }
        }
      });
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => { alive = false; cancelAnimationFrame(rafRef.current); };
  }, []);

  /* ---- trails visibility ---- */
  useEffect(() => {
    store.current.forEach((rec) => rec.trail.forEach((t) => {
      const el = t.getElement && t.getElement();
      if (el) el.style.display = showTrails ? "" : "none";
    }));
  }, [showTrails, animals]);

  /* ---- detection radar pulses ---- */
  useEffect(() => {
    (pulses || []).forEach((pl) => {
      if (pulseSeen.current.has(pl.id)) return;
      pulseSeen.current.add(pl.id);
      if (pulseSeen.current.size > 400) pulseSeen.current = new Set([...pulseSeen.current].slice(-200));
      if (pulseLive.current.size >= MAX_PULSES && pl.level !== "HIGH") return;
      const color = LEVEL_COLOR[pl.level] || LEVEL_COLOR.LOW;
      const icon = L.divIcon({
        className: "kv-radar-wrap", iconSize: [0, 0],
        html: `<div class="kv-radar ${pl.level === "HIGH" ? "high" : ""}" style="--kv-c:${color}"><i></i><i></i><i></i><b></b></div>`,
      });
      const marker = L.marker([pl.lat, pl.lng], { icon, interactive: false, keyboard: false, zIndexOffset: 400 }).addTo(map);
      const timer = setTimeout(() => { marker.remove(); pulseLive.current.delete(pl.id); }, PULSE_MS);
      pulseLive.current.set(pl.id, { marker, timer });
    });
  }, [pulses, map]);

  /* ---- full cleanup ---- */
  useEffect(() => () => {
    store.current.forEach((rec) => { rec.marker.remove(); rec.trail.forEach((t) => t.remove()); });
    store.current.clear();
    pulseLive.current.forEach(({ marker, timer }) => { clearTimeout(timer); marker.remove(); });
    pulseLive.current.clear();
  }, []);

  return null;
}
