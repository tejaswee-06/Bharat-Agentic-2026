// Thin client for the FastAPI /gis/* endpoints (see backend/gis/router.py).
// Every call fails soft (resolves to an empty FeatureCollection) instead
// of throwing, so a judge can demo the GIS map even if the PostGIS
// container isn't running — the panel just shows a small "offline"
// notice instead of crashing the page.

import { API_BASE_URL } from "../KavachApp.jsx";

const EMPTY_FC = { type: "FeatureCollection", features: [] };

async function getJSON(path) {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`);
    if (!res.ok) return { ...EMPTY_FC, warning: `HTTP ${res.status}` };
    return await res.json();
  } catch (err) {
    return { ...EMPTY_FC, warning: "GIS backend unreachable" };
  }
}

export function fetchProtectedAreas() {
  return getJSON("/gis/protected-areas");
}

export function fetchZones({ risk = "all", species = "all" } = {}) {
  const params = new URLSearchParams();
  if (risk && risk !== "all") params.set("risk", risk);
  if (species && species !== "all") params.set("species", species);
  const qs = params.toString();
  return getJSON(`/gis/zones${qs ? `?${qs}` : ""}`);
}

export function fetchHotspots({ risk = "all", species = "all" } = {}) {
  const params = new URLSearchParams();
  if (risk && risk !== "all") params.set("risk", risk);
  if (species && species !== "all") params.set("species", species);
  const qs = params.toString();
  return getJSON(`/gis/hotspots${qs ? `?${qs}` : ""}`);
}

export function fetchDetections({ species = "all", risk = "all", limit = 200 } = {}) {
  const params = new URLSearchParams();
  if (species && species !== "all") params.set("species", species);
  if (risk && risk !== "all") params.set("risk", risk);
  params.set("limit", String(limit));
  return getJSON(`/gis/detections?${params.toString()}`);
}

export async function fetchGISHealth() {
  try {
    const res = await fetch(`${API_BASE_URL}/gis/health`);
    if (!res.ok) return { postgis_available: false };
    return await res.json();
  } catch {
    return { postgis_available: false };
  }
}

/* ------------------------------------------------------------------
 * SIMULATION API (synthetic demo data — see backend/gis/simulator.py)
 * ---------------------------------------------------------------- */

async function requestJSON(path, method = "GET", body) {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export const fetchSimSnapshot = ({ geometry = false } = {}) =>
  requestJSON(`/gis/simulation/snapshot?geometry=${geometry ? "true" : "false"}`);
export const simStart = () => requestJSON("/gis/simulation/start", "POST");
export const simStop = () => requestJSON("/gis/simulation/stop", "POST");
export const simReset = () => requestJSON("/gis/simulation/reset", "POST");
export const simSetSpeed = (speed) => requestJSON("/gis/simulation/speed", "POST", { speed });

/** Opens the Server-Sent-Events stream. Returns a close() function.
 *  onSnapshot(snapshot) fires once per simulation tick (never faster). */
export function openSimStream({ onSnapshot, onOpen, onError }) {
  const es = new EventSource(`${API_BASE_URL}/gis/simulation/stream`);
  es.onopen = () => onOpen && onOpen();
  es.addEventListener("snapshot", (ev) => {
    try { onSnapshot(JSON.parse(ev.data)); } catch { /* ignore malformed frame */ }
  });
  es.onerror = () => onError && onError();
  return () => es.close();
}
