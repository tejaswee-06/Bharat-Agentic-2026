"""
FastAPI router for the KAVACH GIS layer.

Mounted into the existing backend/predict.py app, so it runs on the
same server/port the frontend already talks to — no new service for
the frontend to configure.

    GET  /gis/protected-areas   real Maharashtra forest/reserve boundaries (GeoJSON polygons)
    GET  /gis/zones             protected areas enriched with live aggregated risk
    GET  /gis/hotspots          ML-risk hotspots (GeoJSON points, with risk_level/species filters)
    GET  /gis/detections        resolved wildlife detections (GeoJSON points)
    POST /gis/resolve           internal: resolve a detection+risk score to a real location
    GET  /gis/health            PostGIS connectivity check

Simulation (synthetic demo data, always labelled SIMULATION DATA):
    GET  /gis/simulation/status     running flag, speed, counters, mode (postgis|memory)
    GET  /gis/simulation/animals    simulated animals as GeoJSON points (+ trail)
    GET  /gis/simulation/tracks     bounded movement history as GeoJSON LineStrings
    GET  /gis/simulation/events     event feed (?since_seq=&limit=)
    GET  /gis/simulation/snapshot   everything the live map needs, in one payload
    GET  /gis/simulation/stream     the same snapshot pushed as Server-Sent Events
    POST /gis/simulation/start | stop | reset | speed
"""

import asyncio
import json
import os
import time

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

from .database import get_connection, dict_cursor, is_available
from .spatial import record_detection, resolve_zone_code_to_point, risk_level_from_score

router = APIRouter(prefix="/gis", tags=["GIS"])

# The simulator is an OPTIONAL add-on: if it fails to import for any reason the
# rest of the GIS layer (and the YOLO / risk pipeline) keeps working.
try:
    from .simulator import get_simulator
    SIM_AVAILABLE = True
except Exception as _sim_err:  # noqa: BLE001
    get_simulator = None
    SIM_AVAILABLE = False
    _SIM_IMPORT_ERROR = str(_sim_err)


def _empty_fc(warning=None):
    fc = {"type": "FeatureCollection", "features": []}
    if warning:
        fc["warning"] = warning
    return fc


@router.get("/health")
def health():
    return {"postgis_available": is_available(), "simulation_available": SIM_AVAILABLE}


@router.get("/protected-areas")
def get_protected_areas():
    """Real Maharashtra forest / protected-area boundaries as GeoJSON polygons."""
    if not is_available():
        return _empty_fc("PostGIS unavailable — run docker-compose up and seed_protected_areas.py")

    conn = get_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute(
                """
                SELECT code, name, area_type, district, official_area_km2, primary_species,
                       ST_AsGeoJSON(geom)::json AS geometry
                FROM protected_areas
                ORDER BY name
                """
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    features = [
        {
            "type": "Feature",
            "geometry": r["geometry"],
            "properties": {
                "code": r["code"],
                "name": r["name"],
                "area_type": r["area_type"],
                "district": r["district"],
                "official_area_km2": float(r["official_area_km2"]) if r["official_area_km2"] else None,
                "primary_species": r["primary_species"],
            },
        }
        for r in rows
    ]
    return {"type": "FeatureCollection", "features": features}


@router.get("/zones")
def get_zones(risk: Optional[str] = Query(None, description="all | low | medium | high | active"),
              species: Optional[str] = Query(None)):
    """Protected areas enriched with their current aggregated risk
    (derived from that reserve's live hotspots) — the real-data
    equivalent of the old demo ZONES list, keyed by real forest name
    instead of a fake Z-id.
    """
    if not is_available():
        return _empty_fc("PostGIS unavailable — run docker-compose up and seed_protected_areas.py")

    conn = get_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute(
                """
                SELECT pa.code, pa.name, pa.area_type, pa.district, pa.official_area_km2,
                       pa.primary_species, ST_AsGeoJSON(pa.geom)::json AS geometry,
                       COALESCE(MAX(h.risk_score), 0) AS risk_score,
                       COALESCE(SUM(h.detection_count), 0) AS detection_count,
                       array_remove(array_agg(DISTINCT cam.zone_code), NULL) AS camera_zones
                FROM protected_areas pa
                LEFT JOIN hotspots h ON h.protected_area_id = pa.id
                LEFT JOIN camera_locations cam ON cam.protected_area_id = pa.id
                GROUP BY pa.id
                ORDER BY pa.name
                """
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    features = []
    for r in rows:
        score = float(r["risk_score"])
        level = risk_level_from_score(score) if score > 0 else "LOW"
        if species and r["primary_species"] != species:
            continue
        if risk and risk != "all":
            if risk == "active" and level == "LOW" and score == 0:
                continue
            if risk in ("low", "medium", "high") and level.lower() != risk:
                continue
        features.append({
            "type": "Feature",
            "geometry": r["geometry"],
            "properties": {
                "code": r["code"],
                "name": r["name"],
                "area_type": r["area_type"],
                "district": r["district"],
                "official_area_km2": float(r["official_area_km2"]) if r["official_area_km2"] else None,
                "primary_species": r["primary_species"],
                "risk_score": round(score, 2),
                "risk_level": level,
                "detection_count": int(r["detection_count"]),
                "camera_zones": r["camera_zones"],
            },
        })
    return {"type": "FeatureCollection", "features": features}


@router.get("/hotspots")
def get_hotspots(risk: Optional[str] = Query(None), species: Optional[str] = Query(None)):
    """ML-generated risk hotspots as GeoJSON points, each carrying the
    risk score/level and a radius_m for rendering as a buffered circle.
    """
    if not is_available():
        return _empty_fc("PostGIS unavailable — run docker-compose up and seed_protected_areas.py")

    conn = get_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute(
                """
                SELECT h.id, h.risk_score, h.risk_level, h.species, h.detection_count,
                       h.radius_m, h.updated_at, pa.name AS protected_area_name, pa.code AS protected_area_code,
                       ST_AsGeoJSON(h.geom)::json AS geometry
                FROM hotspots h
                LEFT JOIN protected_areas pa ON pa.id = h.protected_area_id
                ORDER BY h.risk_score DESC
                """
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    features = []
    for r in rows:
        if species and r["species"] != species:
            continue
        if risk and risk != "all":
            if risk == "active" and r["risk_level"] == "LOW":
                continue
            if risk in ("low", "medium", "high") and r["risk_level"].lower() != risk:
                continue
        features.append({
            "type": "Feature",
            "geometry": r["geometry"],
            "properties": {
                "id": r["id"],
                "risk_score": float(r["risk_score"]),
                "risk_level": r["risk_level"],
                "species": r["species"],
                "detection_count": r["detection_count"],
                "radius_m": r["radius_m"],
                "protected_area_name": r["protected_area_name"],
                "protected_area_code": r["protected_area_code"],
                "updated_at": r["updated_at"].isoformat(),
            },
        })
    return {"type": "FeatureCollection", "features": features}


@router.get("/detections")
def get_detections(species: Optional[str] = Query(None), risk: Optional[str] = Query(None), limit: int = 200):
    """Wildlife detection locations as GeoJSON points."""
    if not is_available():
        return _empty_fc("PostGIS unavailable — run docker-compose up and seed_protected_areas.py")

    conn = get_connection()
    try:
        with dict_cursor(conn) as cur:
            cur.execute(
                """
                SELECT d.id, d.zone_code, d.species, d.confidence, d.risk_score, d.risk_level,
                       d.detected_at, pa.name AS protected_area_name, pa.code AS protected_area_code,
                       ST_AsGeoJSON(d.geom)::json AS geometry
                FROM detections d
                LEFT JOIN protected_areas pa ON pa.id = d.protected_area_id
                ORDER BY d.detected_at DESC
                LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    features = []
    for r in rows:
        if species and r["species"] != species:
            continue
        if risk and risk != "all" and r["risk_level"] and r["risk_level"].lower() != risk:
            continue
        features.append({
            "type": "Feature",
            "geometry": r["geometry"],
            "properties": {
                "id": r["id"],
                "zone_code": r["zone_code"],
                "species": r["species"],
                "confidence": float(r["confidence"]),
                "risk_score": float(r["risk_score"]) if r["risk_score"] is not None else None,
                "risk_level": r["risk_level"],
                "protected_area_name": r["protected_area_name"],
                "protected_area_code": r["protected_area_code"],
                "detected_at": r["detected_at"].isoformat(),
            },
        })
    return {"type": "FeatureCollection", "features": features}


class ResolveRequest(BaseModel):
    species: str
    confidence: float
    risk_score: float
    zone_code: Optional[str] = None   # existing frontend zone id, e.g. "Z-04"
    lat: Optional[float] = None       # or a real coordinate directly
    lng: Optional[float] = None


@router.post("/resolve")
def resolve_detection(payload: ResolveRequest):
    """Internal endpoint the existing YOLO+risk flow calls after
    /predict and /risk to attach a real location: given either a
    zone_code (existing frontend concept) or a raw lat/lng (real
    camera GPS), find the real protected area via PostGIS, store the
    detection, and refresh the relevant hotspot.
    """
    if not is_available():
        return {"success": False, "error": "PostGIS unavailable"}

    lat, lng = payload.lat, payload.lng
    if lat is None or lng is None:
        conn = get_connection()
        try:
            with dict_cursor(conn) as cur:
                cam = resolve_zone_code_to_point(cur, payload.zone_code)
        finally:
            conn.close()
        if not cam:
            return {"success": False, "error": f"Unknown zone_code '{payload.zone_code}' and no lat/lng given"}
        lat, lng = cam["lat"], cam["lng"]

    result = record_detection(
        species=payload.species,
        confidence=payload.confidence,
        risk_score=payload.risk_score,
        lat=lat,
        lng=lng,
        zone_code=payload.zone_code,
    )
    return {"success": True, **result}



# ====================================================================
# SIMULATION API
# ====================================================================
def _sim():
    if not SIM_AVAILABLE:
        raise HTTPException(status_code=503, detail=f"Simulation unavailable: {_SIM_IMPORT_ERROR}")
    return get_simulator()


class SpeedRequest(BaseModel):
    speed: float  # 0.5 | 1 | 2 | 5 (any 0.25-8 accepted)


@router.get("/simulation/status")
def sim_status():
    return _sim().status()


@router.get("/simulation/animals")
def sim_animals(species: Optional[str] = Query(None), risk: Optional[str] = Query(None)):
    """Simulated animals as GeoJSON points. properties: animal_id, species,
    risk_score, risk_level, heading, speed, timestamp, trail, ..."""
    fc = dict(_sim().snapshot()["animals"])
    feats = []
    for f in fc["features"]:
        p = f["properties"]
        if species and species != "all" and p["species"] != species:
            continue
        if risk and risk != "all":
            if risk == "active" and p["risk_level"] == "LOW":
                continue
            if risk in ("low", "medium", "high") and p["risk_level"].lower() != risk:
                continue
        feats.append(f)
    fc["features"] = feats
    fc["label"] = "SIMULATION DATA"
    return fc


@router.get("/simulation/tracks")
def sim_tracks():
    fc = _sim().tracks_fc()
    fc["label"] = "SIMULATION DATA"
    return fc


@router.get("/simulation/events")
def sim_events(since_seq: int = 0, limit: int = Query(50, ge=1, le=300)):
    return {"label": "SIMULATION DATA", "events": _sim().get_events(since_seq, limit)}


@router.get("/simulation/snapshot")
def sim_snapshot(geometry: bool = False):
    """Polling fallback for the live map (used if SSE is unavailable)."""
    return _sim().snapshot(include_geometry=geometry)


@router.post("/simulation/start")
def sim_start():
    return _sim().start()


@router.post("/simulation/stop")
def sim_stop():
    return _sim().stop()


@router.post("/simulation/reset")
def sim_reset():
    return _sim().reset()


@router.post("/simulation/speed")
def sim_speed(body: SpeedRequest):
    return _sim().set_speed(body.speed)


@router.get("/simulation/stream")
async def sim_stream(request: Request):
    """Server-Sent Events: pushes a snapshot whenever the simulation state
    changes (one push per tick, never faster), plus a refresh every 5 s while
    idle. One long-lived request replaces per-second polling."""
    sim = _sim()

    async def gen():
        last_version, last_sent, first = -1, 0.0, True
        yield "retry: 3000\n\n"
        while True:
            if await request.is_disconnected():
                break
            version = sim.version
            now = time.monotonic()
            if version != last_version or now - last_sent > 5.0:
                snap = sim.snapshot(include_geometry=first)
                first = False
                last_version, last_sent = version, now
                yield f"event: snapshot\ndata: {json.dumps(snap)}\n\n"
            await asyncio.sleep(0.25)

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# Optional: KAVACH_SIM_AUTOSTART=1 starts the simulation as soon as the API boots.
if SIM_AVAILABLE and os.environ.get("KAVACH_SIM_AUTOSTART") == "1":
    try:
        get_simulator().start()
    except Exception:  # noqa: BLE001
        pass
