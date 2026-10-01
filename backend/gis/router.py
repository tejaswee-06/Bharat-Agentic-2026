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
"""

from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import Optional

from .database import get_connection, dict_cursor, is_available
from .spatial import record_detection, resolve_zone_code_to_point, risk_level_from_score

router = APIRouter(prefix="/gis", tags=["GIS"])


def _empty_fc(warning=None):
    fc = {"type": "FeatureCollection", "features": []}
    if warning:
        fc["warning"] = warning
    return fc


@router.get("/health")
def health():
    return {"postgis_available": is_available()}


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
