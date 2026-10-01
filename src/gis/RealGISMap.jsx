import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer, TileLayer, GeoJSON, CircleMarker, Tooltip, useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./gis-map.css";
import {
  ZoomIn, ZoomOut, Layers, Compass, X, ArrowRight, MapPin, Satellite, Radio,
} from "lucide-react";

import {
  useApp, SPECIES_LIST, riskVar, RiskBadge, selStyle, ZONES,
} from "../KavachApp.jsx";
import { fetchZones, fetchHotspots, fetchDetections, fetchGISHealth } from "./api.js";

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

export default function RealGISMap() {
  const { selectedZoneId, setSelectedZoneId, gisRiskFilter, setGisRiskFilter, gisSpeciesFilter, setGisSpeciesFilter, navigate } = useApp();

  const [layer, setLayer] = useState("risk"); // "risk" | "species"
  const [zonesFC, setZonesFC] = useState({ type: "FeatureCollection", features: [] });
  const [hotspotsFC, setHotspotsFC] = useState({ type: "FeatureCollection", features: [] });
  const [detectionsFC, setDetectionsFC] = useState({ type: "FeatureCollection", features: [] });
  const [health, setHealth] = useState({ postgis_available: null });
  const [selectedPACode, setSelectedPACode] = useState(null);
  const [loading, setLoading] = useState(true);

  const controllerRef = useRef(null);

  // Existing pages (Command Center KPI cards, Alerts "VIEW ON MAP") still
  // navigate here with a demo Z-id. Translate it to the real reserve.
  useEffect(() => {
    if (selectedZoneId && ZONE_TO_PA[selectedZoneId]) {
      setSelectedPACode(ZONE_TO_PA[selectedZoneId]);
    }
  }, [selectedZoneId]);

  async function loadAll() {
    setLoading(true);
    const [z, h, d, hc] = await Promise.all([
      fetchZones({ risk: gisRiskFilter, species: gisSpeciesFilter }),
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

  const selectedFeature = useMemo(
    () => zonesFC.features.find(f => f.properties.code === selectedPACode) || null,
    [zonesFC, selectedPACode]
  );

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
    return {
      color,
      weight: isSelected ? 3 : 1.4,
      fillColor: color,
      fillOpacity: isSelected ? 0.34 : 0.16,
      opacity: 0.9,
    };
  };

  function onEachZone(feature, layerObj) {
    const p = feature.properties;
    layerObj.bindTooltip(
      `<b>${p.name}</b><br/>${p.area_type} · ${p.district || ""}<br/>Risk: ${p.risk_level} (${p.risk_score}%)`,
      { sticky: true, className: "kv-leaflet-tooltip" }
    );
    layerObj.on({
      click: () => {
        setSelectedPACode(p.code);
        setSelectedZoneId(null);
      },
      mouseover: (e) => e.target.setStyle({ weight: 3, fillOpacity: 0.4 }),
      mouseout: (e) => { if (p.code !== selectedPACode) e.target.setStyle(geoJsonStyle(feature)); },
    });
  }

  const visibleZoneCount = zonesFC.features.length;
  const gisOnline = health.postgis_available === true;

  return (
    <div className="kv-fadein" style={{ display: "grid", gridTemplateColumns: selectedFeature ? "1fr 340px" : "1fr", gap: 18 }}>
      <div className="kv-panel" style={{ padding: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={gisRiskFilter} onChange={e => setGisRiskFilter(e.target.value)} style={selStyle}>
              <option value="all">Risk: All</option>
              <option value="low">Risk: Low</option>
              <option value="medium">Risk: Medium</option>
              <option value="high">Risk: High</option>
              <option value="active">Risk: Active (Med+High)</option>
            </select>
            <select value={gisSpeciesFilter} onChange={e => setGisSpeciesFilter(e.target.value)} style={selStyle}>
              <option value="all">Species: All</option>
              {SPECIES_LIST.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="kv-btn" onClick={() => setLayer(l => l === "risk" ? "species" : "risk")} style={{ fontSize: 11 }}>
              <Layers size={13} /> LAYER: {layer.toUpperCase()}
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="kv-btn" onClick={() => controllerRef.current?.zoomOut()}><ZoomOut size={14} /></button>
            <button className="kv-btn" onClick={() => controllerRef.current?.recenter()}><Compass size={14} /></button>
            <button className="kv-btn" onClick={() => controllerRef.current?.zoomIn()}><ZoomIn size={14} /></button>
          </div>
        </div>

        <div style={{ position: "relative", height: 560, borderRadius: 4, overflow: "hidden", border: "1px solid var(--line-soft)" }}>
          <MapContainer
            center={MAHARASHTRA_CENTER}
            zoom={MAHARASHTRA_ZOOM}
            style={{ width: "100%", height: "100%", background: "#0a100c" }}
            zoomControl={false}
            attributionControl={true}
          >
            <MapController controllerRef={controllerRef} />
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a> · Protected-area boundaries: KAVACH GIS (public sources)'
            />

            {zonesFC.features.length > 0 && (
              <GeoJSON
                key={`zones-${layer}-${zonesFC.features.length}-${selectedPACode}`}
                data={zonesFC}
                style={geoJsonStyle}
                onEachFeature={onEachZone}
              />
            )}

            {hotspotsFC.features.map((f) => {
              const p = f.properties;
              const [lng, lat] = f.geometry.coordinates;
              const color = riskVar(p.risk_level);
              return (
                <CircleMarker
                  key={`hotspot-${p.id}`}
                  center={[lat, lng]}
                  radius={8 + Math.min(14, p.risk_score / 6)}
                  pathOptions={{
                    color, weight: 2, fillColor: color,
                    fillOpacity: 0.35, className: p.risk_level === "HIGH" ? "kv-hotspot-pulse" : "",
                  }}
                >
                  <Tooltip className="kv-leaflet-tooltip">
                    <b>{p.protected_area_name}</b><br />
                    {p.species} · {p.risk_level} risk ({p.risk_score}%)<br />
                    {p.detection_count} detection(s) clustered
                  </Tooltip>
                </CircleMarker>
              );
            })}

            {!gisOnline && !loading && ZONES.map((z) => {
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

            {detectionsFC.features.map((f) => {
              const p = f.properties;
              const [lng, lat] = f.geometry.coordinates;
              return (
                <CircleMarker
                  key={`det-${p.id}`}
                  center={[lat, lng]}
                  radius={3.5}
                  pathOptions={{ color: "#e9e4d8", weight: 1, fillColor: riskVar(p.risk_level || "LOW"), fillOpacity: 0.9 }}
                >
                  <Tooltip className="kv-leaflet-tooltip">
                    {p.species} · {p.confidence}% conf · {p.protected_area_name || "Unresolved"}
                  </Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>

          <div style={{ position: "absolute", bottom: 12, left: 12, display: "flex", gap: 14, zIndex: 500, pointerEvents: "none" }} className="kv-mono">
            {["LOW", "MEDIUM", "HIGH"].map(l => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "var(--text-muted)", background: "rgba(10,16,12,0.7)", padding: "3px 7px", borderRadius: 3 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: riskVar(l) }} /> {l}
              </div>
            ))}
          </div>

          <div style={{ position: "absolute", top: 12, right: 14, zIndex: 500, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <div className="kv-tag" style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Satellite size={11} />
              {loading ? "LOADING…" : `${visibleZoneCount} RESERVES SHOWN`}
            </div>
            <div className="kv-tag" style={{ color: gisOnline ? "var(--low)" : "var(--high)", borderColor: gisOnline ? "#2c4a35" : undefined }}>
              <Radio size={11} style={{ marginRight: 4 }} />
              {health.postgis_available === null ? "CHECKING…" : gisOnline ? "POSTGIS LIVE" : "GIS OFFLINE — DEMO MODE"}
            </div>
          </div>
        </div>
      </div>

      {selectedFeature && (
        <div className="kv-panel kv-slidein" style={{ padding: 20, height: "fit-content", position: "sticky", top: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div className="kv-mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{selectedFeature.properties.code}</div>
              <div className="kv-display" style={{ fontSize: 19, fontWeight: 700 }}>{selectedFeature.properties.name}</div>
            </div>
            <button onClick={() => { setSelectedPACode(null); setSelectedZoneId(null); }} style={{ background: "transparent", border: "none", color: "var(--text-dim)" }}><X size={16} /></button>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 14 }}>
            <div className="kv-display" style={{ fontSize: 36, fontWeight: 700, color: riskVar(selectedFeature.properties.risk_level) }}>
              {selectedFeature.properties.risk_score}%
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
              Boundary and risk hotspots sourced from PostGIS via live spatial queries
              (ST_Contains / ST_DWithin) against this reserve's real coordinates and
              published area of {selectedFeature.properties.official_area_km2} km².
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
    </div>
  );
}
