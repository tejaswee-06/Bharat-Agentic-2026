import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer, TileLayer, GeoJSON, CircleMarker, Tooltip, useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./gis-map.css";
import "./simulation.css";
import {
  ZoomIn, ZoomOut, Layers, Compass, X, ArrowRight, MapPin, Satellite, Radio, Route,
} from "lucide-react";

import {
  useApp, SPECIES_LIST, riskVar, RiskBadge, selStyle, ZONES,
} from "../KavachApp.jsx";
import { fetchZones, fetchHotspots, fetchDetections, fetchGISHealth } from "./api.js";
import { useSim } from "./SimulationContext.jsx";
import SimulationLayer from "./SimulationLayer.jsx";
import SimControlPanel, { simStateLabel } from "./SimControlPanel.jsx";
import { AnimalPanel, HotspotPanel } from "./SimPanels.jsx";
import LiveEventFeed from "../components/LiveEventFeed.jsx";

// Rough real-world lat/lng for each demo Z-id's protected area, used only
// as an offline fallback overlay so the map isn't empty if PostGIS isn't
// running for a demo — mirrors backend/gis/seed_protected_areas.py.
const OFFLINE_ZONE_COORDS = {
  "Z-01": [21.24, 80.02], "Z-02": [20.9775, 78.6758], "Z-03": [19.25, 72.917],
  "Z-04": [20.2667, 79.4], "Z-05": [18.9086, 73.1025], "Z-06": [20.24, 79.38],
  "Z-07": [21.4458, 77.1972],
};

/* ------------------------------------------------------------------
 * Bridges the EXISTING demo zone ids (Z-01..Z-07), used throughout
 * the rest of the app (Command Center, Alerts, Risk Intelligence),
 * to the real protected-area codes now backing the GIS map. Mirrors
 * backend/gis/seed_protected_areas.py CAMERA_LOCATIONS.
 * ---------------------------------------------------------------- */
const ZONE_TO_PA = {
  "Z-01": "PA-NNTR", "Z-02": "PA-BOR", "Z-03": "PA-SGNP", "Z-04": "PA-TATR",
  "Z-05": "PA-KARN", "Z-06": "PA-TATR", "Z-07": "PA-MELG",
};

const MAHARASHTRA_CENTER = [19.6, 76.0];
const MAHARASHTRA_ZOOM = 6;
const EMPTY_FC = { type: "FeatureCollection", features: [] };
const MAX_DETECTION_DOTS = 200;

// Same semantics as the server-side filters in backend/gis/router.py,
// applied client-side so live simulation data can be filtered without refetching.
const matchRisk = (level, filter) =>
  filter === "all" || (filter === "active" ? level !== "LOW" : String(level).toLowerCase() === filter);
const matchSpecies = (species, filter) => filter === "all" || species === filter;

function InfoCell({ label, value, small }) {
  return (
    <div style={{ background: "var(--panel-raised)", border: "1px solid var(--line-soft)", borderRadius: 3, padding: "9px 11px" }}>
      <div className="kv-mono" style={{ fontSize: 9.5, color: "var(--text-dim)", marginBottom: 4 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: small ? 11.5 : 14, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

/* Imperative helpers so the existing zoom/recenter buttons can drive
 * the real Leaflet map instance. */
function MapController({ controllerRef, fitBounds }) {
  const map = useMap();
  useEffect(() => {
    controllerRef.current = {
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
      recenter: () => map.setView(MAHARASHTRA_CENTER, MAHARASHTRA_ZOOM),
      flyTo: (lat, lng, zoom = 9) => map.flyTo([lat, lng], zoom, { duration: 0.6 }),
    };
    if (fitBounds) {
      try { map.fitBounds(fitBounds, { padding: [24, 24] }); } catch { /* no-op */ }
    }
  }, [map, controllerRef, fitBounds]);
  return null;
}

const zoneTip = (p) =>
  `<b>${p.name}</b><br/>${p.area_type} · ${p.district || ""}<br/>Risk: ${p.risk_level} (${Math.round(p.risk_score)}%)` +
  (p.recent_detections ? `<br/><i>${p.recent_detections} detection(s) in last 60 s</i>` : "");

export default function RealGISMap() {
  const {
    selectedZoneId, setSelectedZoneId, gisRiskFilter, setGisRiskFilter,
    gisSpeciesFilter, setGisSpeciesFilter, navigate,
  } = useApp();
  const sim = useSim();
  const snap = sim ? sim.snap : null;
  const simStatus = sim ? sim.status : null;
  const live = !!(sim && sim.live);

  const [layer, setLayer] = useState("risk"); // "risk" | "species"
  const [zonesFC, setZonesFC] = useState(EMPTY_FC);
  const [hotspotsFC, setHotspotsFC] = useState(EMPTY_FC);
  const [detectionsFC, setDetectionsFC] = useState(EMPTY_FC);
  const [health, setHealth] = useState({ postgis_available: null });
  const [selectedPACode, setSelectedPACode] = useState(null);
  const [selectedAnimalId, setSelectedAnimalId] = useState(null);
  const [selectedHotspotId, setSelectedHotspotId] = useState(null);
  const [showTrails, setShowTrails] = useState(true);
  const [pulses, setPulses] = useState([]);
  const [loading, setLoading] = useState(true);

  const controllerRef = useRef(null);
  const geoRef = useRef(null);
  const prevRecent = useRef({});
  const detSeen = useRef({ run: null, ids: null });
  const wasLive = useRef(live);

  // Existing pages (Command Center KPI cards, Alerts "VIEW ON MAP") still
  // navigate here with a demo Z-id — or, for simulated alerts, a PA code.
  useEffect(() => {
    if (!selectedZoneId) return;
    const code = ZONE_TO_PA[selectedZoneId] || (String(selectedZoneId).startsWith("PA-") ? selectedZoneId : null);
    if (code) { setSelectedPACode(code); setSelectedAnimalId(null); setSelectedHotspotId(null); }
  }, [selectedZoneId]);

  async function loadAll() {
    setLoading(true);
    const [z, h, d, hc] = await Promise.all([
      fetchZones(),                                   // unfiltered: filtered client-side so live risk can drive it
      fetchHotspots({ risk: gisRiskFilter, species: gisSpeciesFilter }),
      fetchDetections({ species: gisSpeciesFilter, risk: gisRiskFilter === "active" ? "all" : gisRiskFilter }),
      fetchGISHealth(),
    ]);
    setZonesFC(z);
    setHotspotsFC(h);
    setDetectionsFC(d);
    setHealth(hc);
    setLoading(false);
  }

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [gisRiskFilter, gisSpeciesFilter]);

  // After a simulation RESET the database no longer holds the simulated rows:
  // re-read the REST layers so no stale simulated dots remain.
  useEffect(() => {
    if (wasLive.current && !live) { loadAll(); setSelectedAnimalId(null); setSelectedHotspotId(null); }
    wasLive.current = live;
    // eslint-disable-next-line
  }, [live]);

  /* ---------------- derived layer data ---------------- */
  const zoneFeatures = useMemo(() => {
    const base = zonesFC.features.length
      ? zonesFC.features
      : (live && sim.geometry ? sim.geometry.features : []);
    const zoneRisk = (live && snap && snap.zones) || {};
    return base
      .map((f) => {
        const z = zoneRisk[f.properties.code];
        return {
          ...f,
          properties: { risk_score: 0, risk_level: "LOW", detection_count: 0, ...f.properties, ...(z || {}) },
        };
      })
      .filter((f) => matchRisk(f.properties.risk_level, gisRiskFilter) && matchSpecies(f.properties.primary_species, gisSpeciesFilter));
  }, [zonesFC, live, sim && sim.geometry, snap, gisRiskFilter, gisSpeciesFilter]); // eslint-disable-line

  const zonesData = useMemo(() => ({ type: "FeatureCollection", features: zoneFeatures }), [zoneFeatures]);
  const zoneKey = useMemo(() => zoneFeatures.map((f) => f.properties.code).join("|"), [zoneFeatures]);

  const hotspotFeatures = useMemo(() => {
    const src = live && snap ? snap.hotspots.features : hotspotsFC.features;
    return src.filter((f) => matchRisk(f.properties.risk_level, gisRiskFilter) && matchSpecies(f.properties.species, gisSpeciesFilter));
  }, [live, snap, hotspotsFC, gisRiskFilter, gisSpeciesFilter]);

  const detectionFeatures = useMemo(() => {
    if (!(live && snap)) return detectionsFC.features;
    const byId = new Map();
    detectionsFC.features.forEach((f) => byId.set(f.properties.id, f));
    snap.detections.features
      .filter((f) => matchRisk(f.properties.risk_level || "LOW", gisRiskFilter === "active" ? "all" : gisRiskFilter) && matchSpecies(f.properties.species, gisSpeciesFilter))
      .forEach((f) => byId.set(f.properties.id, f));
    return [...byId.values()]
      .sort((a, b) => String(b.properties.detected_at).localeCompare(String(a.properties.detected_at)))
      .slice(0, MAX_DETECTION_DOTS);
  }, [live, snap, detectionsFC, gisRiskFilter, gisSpeciesFilter]);

  const animalsFC = useMemo(() => {
    const feats = (snap && snap.animals ? snap.animals.features : []).filter(
      (f) => matchRisk(f.properties.risk_level, gisRiskFilter) && matchSpecies(f.properties.species, gisSpeciesFilter)
    );
    return { type: "FeatureCollection", features: feats };
  }, [snap, gisRiskFilter, gisSpeciesFilter]);

  const selectedFeature = useMemo(
    () => zoneFeatures.find((f) => f.properties.code === selectedPACode) || null,
    [zoneFeatures, selectedPACode]
  );
  const selectedAnimal = useMemo(
    () => animalsFC.features.find((f) => f.properties.animal_id === selectedAnimalId) || null,
    [animalsFC, selectedAnimalId]
  );
  const selectedHotspot = useMemo(
    () => hotspotFeatures.find((f) => f.properties.id === selectedHotspotId) || null,
    [hotspotFeatures, selectedHotspotId]
  );

  /* ---------------- radar pulses for new detections ---------------- */
  useEffect(() => {
    const feats = snap && snap.detections ? snap.detections.features : null;
    if (!feats) return;
    const run = (snap.status && snap.status.started_at) || "idle";
    const key = (f) => `${run}:${f.properties.id}`;
    if (detSeen.current.run !== run || detSeen.current.ids === null) {
      detSeen.current = { run, ids: new Set(feats.map(key)) };   // history on first load: no pulses
      return;
    }
    const fresh = feats.filter((f) => !detSeen.current.ids.has(key(f)));
    if (!fresh.length) return;
    fresh.forEach((f) => detSeen.current.ids.add(key(f)));
    const visible = fresh.filter((f) => matchSpecies(f.properties.species, gisSpeciesFilter) && matchRisk(f.properties.risk_level || "LOW", gisRiskFilter === "active" ? "all" : gisRiskFilter));
    setPulses(
      visible.slice(0, 4).map((f) => ({
        id: key(f), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], level: f.properties.risk_level || "LOW",
      }))
    );
    // eslint-disable-next-line
  }, [snap]);

  /* ---------------- zone styling ---------------- */
  const zoneColor = (props) => {
    if (layer === "species") {
      const idx = SPECIES_LIST.indexOf(props.primary_species);
      const palette = ["#4F8A64", "#D99A32", "#C94C4C", "#3B82F6", "#9F7AEA"];
      return palette[idx >= 0 ? idx % palette.length : 0];
    }
    return riskVar(props.risk_level || "LOW");
  };

  const geoJsonStyle = (feature) => {
    const p = feature.properties;
    const isSelected = p.code === selectedPACode;
    const color = zoneColor(p);
    const hot = layer === "risk" && p.risk_level === "HIGH";
    return {
      color,
      weight: isSelected ? 3 : 1.4,
      fillColor: color,
      fillOpacity: isSelected ? 0.34 : hot ? 0.26 : p.risk_level === "MEDIUM" ? 0.2 : 0.16,
      opacity: 0.9,
      className: "kv-zone",
    };
  };

  function onEachZone(feature, layerObj) {
    const p = feature.properties;
    layerObj.bindTooltip(() => zoneTip(layerObj.feature.properties), { sticky: true, className: "kv-leaflet-tooltip" });
    layerObj.on({
      click: () => {
        setSelectedPACode(p.code);
        setSelectedZoneId(null);
        setSelectedAnimalId(null);
        setSelectedHotspotId(null);
      },
      mouseover: (e) => e.target.setStyle({ weight: 3, fillOpacity: 0.4 }),
      mouseout: (e) => { if (p.code !== selectedPACode) e.target.setStyle(geoJsonStyle(e.target.feature)); },
    });
  }

  // Live risk changes mutate the existing polygon layers in place (no remount),
  // so CSS transitions animate colour/opacity changes and HIGH zones glow.
  useEffect(() => {
    const g = geoRef.current;
    if (!g || !g.eachLayer) return;
    const byCode = new Map(zoneFeatures.map((f) => [f.properties.code, f]));
    g.eachLayer((l) => {
      const f = l.feature && byCode.get(l.feature.properties.code);
      if (!f) return;
      l.feature.properties = f.properties;
      l.setStyle(geoJsonStyle(l.feature));
      const el = l.getElement && l.getElement();
      if (!el) return;
      el.classList.toggle("kv-zone-high", layer === "risk" && f.properties.risk_level === "HIGH");
      const code = f.properties.code, recent = f.properties.recent_detections || 0;
      if (recent > (prevRecent.current[code] || 0)) {
        el.classList.remove("kv-zone-active");
        void el.getBoundingClientRect();
        el.classList.add("kv-zone-active");
      }
      prevRecent.current[code] = recent;
    });
    // eslint-disable-next-line
  }, [zoneFeatures, layer, selectedPACode]);

  /* ---------------- selection helpers ---------------- */
  function selectAnimal(id) {
    setSelectedAnimalId(id); setSelectedHotspotId(null); setSelectedPACode(null); setSelectedZoneId(null);
  }
  function selectHotspot(id) {
    setSelectedHotspotId(id); setSelectedAnimalId(null); setSelectedPACode(null); setSelectedZoneId(null);
  }
  function onFeedSelect(e) {
    const a = animalsFC.features.find((f) => f.properties.animal_id === e.animal_id);
    if (a) selectAnimal(e.animal_id);
    if (controllerRef.current) controllerRef.current.flyTo(e.lat, e.lng, 10);
  }
  function focusAnimal() {
    if (!selectedAnimal || !controllerRef.current) return;
    const [lng, lat] = selectedAnimal.geometry.coordinates;
    controllerRef.current.flyTo(lat, lng, 11);
  }

  const visibleZoneCount = zoneFeatures.length;
  const gisOnline = health.postgis_available === true;
  const simMode = simStatus ? simStatus.mode : null;
  const simLocal = live && simMode === "memory";
  const hasSidePanel = !!(selectedFeature || selectedAnimal || selectedHotspot);

  return (
    <div className="kv-fadein kv-gis-grid">
      <div className="kv-panel" style={{ padding: 16, minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select aria-label="Risk filter" value={gisRiskFilter} onChange={e => setGisRiskFilter(e.target.value)} style={selStyle}>
              <option value="all">Risk: All</option>
              <option value="low">Risk: Low</option>
              <option value="medium">Risk: Medium</option>
              <option value="high">Risk: High</option>
              <option value="active">Risk: Active (Med+High)</option>
            </select>
            <select aria-label="Species filter" value={gisSpeciesFilter} onChange={e => setGisSpeciesFilter(e.target.value)} style={selStyle}>
              <option value="all">Species: All</option>
              {SPECIES_LIST.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="kv-btn" onClick={() => setLayer(l => l === "risk" ? "species" : "risk")} style={{ fontSize: 11 }}>
              <Layers size={13} /> LAYER: {layer.toUpperCase()}
            </button>
            <button className="kv-btn" aria-pressed={showTrails} onClick={() => setShowTrails(v => !v)} style={{ fontSize: 11, opacity: showTrails ? 1 : 0.6 }}>
              <Route size={13} /> TRAILS: {showTrails ? "ON" : "OFF"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="kv-btn" aria-label="Zoom out" onClick={() => controllerRef.current?.zoomOut()}><ZoomOut size={14} /></button>
            <button className="kv-btn" aria-label="Recenter map" onClick={() => controllerRef.current?.recenter()}><Compass size={14} /></button>
            <button className="kv-btn" aria-label="Zoom in" onClick={() => controllerRef.current?.zoomIn()}><ZoomIn size={14} /></button>
          </div>
        </div>

        <div className="kv-map-shell">
          <MapContainer
            center={MAHARASHTRA_CENTER}
            zoom={MAHARASHTRA_ZOOM}
            style={{ width: "100%", height: "100%", background: "#06110B" }}
            zoomControl={false}
            attributionControl={true}
          >
            <MapController controllerRef={controllerRef} />
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a> · Protected-area boundaries: KAVACH GIS (public sources)'
            />

            {zoneFeatures.length > 0 && (
              <GeoJSON
                ref={geoRef}
                key={`zones-${layer}-${zoneKey}-${selectedPACode}`}
                data={zonesData}
                style={geoJsonStyle}
                onEachFeature={onEachZone}
              />
            )}

            {hotspotFeatures.map((f) => {
              const p = f.properties;
              const [lng, lat] = f.geometry.coordinates;
              const color = riskVar(p.risk_level);
              const high = p.risk_level === "HIGH";
              return (
                <CircleMarker
                  key={`hotspot-${p.id}-${high ? "h" : "n"}`}
                  center={[lat, lng]}
                  radius={8 + Math.min(16, p.risk_score / 5)}
                  eventHandlers={{ click: () => selectHotspot(p.id) }}
                  pathOptions={{
                    color, weight: 2, fillColor: color,
                    fillOpacity: 0.35, className: `kv-hotspot${high ? " kv-hotspot-pulse" : ""}`,
                  }}
                >
                  <Tooltip className="kv-leaflet-tooltip">
                    <b>{p.protected_area_name}</b><br />
                    {p.species} · {p.risk_level} risk ({Math.round(p.risk_score)}%)<br />
                    {p.detection_count} detection(s) clustered
                    {p.source === "simulation" && <><br /><i>SIMULATION DATA</i></>}
                  </Tooltip>
                </CircleMarker>
              );
            })}

            {!gisOnline && !loading && !live && ZONES.map((z) => {
              const coords = OFFLINE_ZONE_COORDS[z.id];
              if (!coords) return null;
              const color = riskVar(z.riskLevel);
              return (
                <CircleMarker
                  key={`offline-${z.id}`}
                  center={coords}
                  radius={9}
                  pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.4 }}
                >
                  <Tooltip className="kv-leaflet-tooltip">
                    <b>{z.id} · {z.name}</b><br />
                    {z.species} · {z.riskLevel} risk ({z.risk}%)<br />
                    <i>Demo data — connect PostGIS for live boundaries</i>
                  </Tooltip>
                </CircleMarker>
              );
            })}

            {detectionFeatures.map((f) => {
              const p = f.properties;
              const [lng, lat] = f.geometry.coordinates;
              const simulated = p.source === "simulation";
              return (
                <CircleMarker
                  key={`det-${p.id}`}
                  center={[lat, lng]}
                  radius={simulated ? 3 : 3.5}
                  pathOptions={{
                    color: simulated ? "#8FAF78" : "#e9e4d8", weight: 1,
                    fillColor: riskVar(p.risk_level || "LOW"), fillOpacity: simulated ? 0.7 : 0.9,
                  }}
                >
                  <Tooltip className="kv-leaflet-tooltip">
                    {p.species} · {p.confidence}% conf · {p.protected_area_name || "Unresolved"}
                    {simulated && <><br /><i>SIMULATION DATA</i></>}
                  </Tooltip>
                </CircleMarker>
              );
            })}

            <SimulationLayer
              animals={animalsFC}
              intervalMs={simStatus ? simStatus.interval_s * 1000 : 3000}
              running={!!(simStatus && simStatus.running)}
              pulses={pulses}
              selectedId={selectedAnimalId}
              onSelect={selectAnimal}
              showTrails={showTrails}
            />
          </MapContainer>

          <div className="kv-map-vignette" />
          <div className="kv-map-sweep" />

          {/* HUD */}
          <div className="kv-hud" aria-hidden="false">
            <div className="t">KAVACH LIVE GIS</div>
            <div className="s">
              <span className={`kv-live-dot ${simStatus && simStatus.running ? "on" : simStatus ? "warn" : "bad"}`} />
              {simStatus && simStatus.running ? "SIMULATION ACTIVE" : `SIMULATION ${simStateLabel(sim ? sim.link : "offline", simStatus)}`}
            </div>
            {simStatus ? (
              <>
                <div className="r"><span>Animals</span><b>{simStatus.animals_active}</b></div>
                <div className="r"><span>Detections/min</span><b>{simStatus.detections_per_min}</b></div>
                <div className="r"><span>Active hotspots</span><b>{simStatus.hotspots_active}</b></div>
              </>
            ) : (
              <div className="r"><span>Simulation API</span><b>offline</b></div>
            )}
            <div className="r" style={{ marginTop: 3 }}>
              <span>{gisOnline ? "REAL GIS DATA" : "MAP ONLINE"}</span>
              <b style={{ color: "var(--gold)" }}>{live ? "+ SIMULATION DATA" : ""}</b>
            </div>
          </div>

          <div className="kv-legend kv-mono">
            {["LOW", "MEDIUM", "HIGH"].map(l => (
              <span key={l}><i className="dot" style={{ background: riskVar(l) }} />{l}</span>
            ))}
            <span><i className="ln" />Movement</span>
            <span><i className="ring" />Live detection</span>
          </div>

          <div style={{ position: "absolute", top: 12, right: 14, zIndex: 600, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <div className="kv-tag" style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Satellite size={11} />
              {loading ? "LOADING…" : `${visibleZoneCount} RESERVES SHOWN`}
            </div>
            <div className="kv-tag" style={{ color: gisOnline ? "var(--low)" : "var(--high)", borderColor: gisOnline ? "#2c4a35" : undefined }}>
              <Radio size={11} style={{ marginRight: 4 }} />
              {health.postgis_available === null
                ? "CHECKING…"
                : gisOnline ? "POSTGIS LIVE"
                  : "MAP ONLINE · SIMULATION LOCAL"}
            </div>
            {live && <div className="kv-sim-tag">SIMULATION DATA</div>}
          </div>
        </div>
      </div>

      <div className="kv-gis-side">
        {selectedAnimal && (
          <AnimalPanel feature={selectedAnimal} onClose={() => setSelectedAnimalId(null)} onFocus={focusAnimal} />
        )}
        {selectedHotspot && (
          <HotspotPanel feature={selectedHotspot} onClose={() => setSelectedHotspotId(null)} />
        )}
        {selectedFeature && (
          <div className="kv-panel kv-slidein" style={{ padding: 20, height: "fit-content" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div className="kv-mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{selectedFeature.properties.code}</div>
                <div className="kv-display" style={{ fontSize: 19, fontWeight: 700 }}>{selectedFeature.properties.name}</div>
              </div>
              <button aria-label="Close" onClick={() => { setSelectedPACode(null); setSelectedZoneId(null); }} style={{ background: "transparent", border: "none", color: "var(--text-dim)" }}><X size={16} /></button>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 14 }}>
              <div className="kv-display" style={{ fontSize: 36, fontWeight: 700, color: riskVar(selectedFeature.properties.risk_level) }}>
                {Math.round(selectedFeature.properties.risk_score)}%
              </div>
              <RiskBadge level={selectedFeature.properties.risk_level} />
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
              {selectedFeature.properties.area_type} · {selectedFeature.properties.primary_species}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
              <InfoCell label="District" value={selectedFeature.properties.district || "—"} small />
              <InfoCell label="Official Area" value={`${selectedFeature.properties.official_area_km2 ?? "—"} km²`} small />
              <InfoCell label="Detections" value={selectedFeature.properties.detection_count} />
              <InfoCell label="Camera Zones" value={(selectedFeature.properties.camera_zones || []).join(", ") || "—"} small />
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="kv-mono" style={{ fontSize: 10.5, color: "var(--text-dim)", marginBottom: 6 }}>
                <MapPin size={11} style={{ marginRight: 4, verticalAlign: -1 }} />REAL PROTECTED-AREA BOUNDARY
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
                {gisOnline
                  ? <>Boundary and risk hotspots sourced from PostGIS via live spatial queries
                    (ST_Contains / ST_DWithin) against this reserve's real coordinates and
                    published area of {selectedFeature.properties.official_area_km2} km².</>
                  : <>Boundary drawn from the same seeded polygon that PostGIS stores for this reserve
                    (published area {selectedFeature.properties.official_area_km2} km²). PostGIS is offline, so risk shown comes from the local simulation.</>}
              </div>
            </div>

            {(selectedFeature.properties.camera_zones || []).length > 0 && (
              <button className="kv-btn kv-btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 18 }}
                onClick={() => navigate("risk", { riskZoneId: selectedFeature.properties.camera_zones[0] })}>
                VIEW FULL RISK ANALYSIS <ArrowRight size={13} />
              </button>
            )}
          </div>
        )}
        <SimControlPanel />
        <LiveEventFeed limit={hasSidePanel ? 5 : 8} onSelect={onFeedSelect} />
      </div>
    </div>
  );
}
