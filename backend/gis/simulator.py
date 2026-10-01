"""
KAVACH real-time wildlife SIMULATION engine.

Everything produced here is synthetic demonstration data and is labelled
"SIMULATION DATA" end to end. It is an ADDITIONAL data source: the real
YOLO -> /risk -> record_detection() pipeline is untouched and both sources
feed the same GIS intelligence layer (detections, hotspots, zones).

Pipeline executed on every tick (default one tick every ~3 s at 1x):

    simulated animal moves (species-specific correlated random walk,
    kept inside its protected-area polygon)
        -> features (species, confidence, recent detections, historical
           conflicts, settlement proximity, time-of-day, environment,
           spatial relationship)
        -> risk score  (the REAL ML risk model when running inside
           predict.py, otherwise the documented analytic fallback)
        -> record_detection(source="simulation")   [PostGIS, or in-memory
           when PostGIS is unavailable]
        -> hotspot aggregation (ST_DWithin clustering, rises AND decays)
        -> events / alerts
        -> cached snapshot served by /gis/simulation/* (SSE or polling)
        -> React-Leaflet animates the change

Design notes
  * State is bounded: <= 40 history points per animal, 300 events,
    1500 simulated detections, 60 persisted track points per animal.
  * One daemon worker thread, controlled by a threading.Event
    (start / pause / reset never spawn extra timers or leak threads).
  * Blocking DB work never runs on the FastAPI event loop: the API only
    reads a cached snapshot guarded by a short lock.
  * Movement is time-compressed (MOVE_SIM_HOURS_PER_TICK) so motion is
    visible in a live demo; speeds are reported in km/h of simulated time.
"""

from __future__ import annotations

import itertools
import logging
import math
import os
import random
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional

from .seed_protected_areas import PROTECTED_AREAS, polygon_from_centroid
from .spatial import SIM_HOTSPOT_CLUSTER_RADIUS_M, sim_blend_score, sim_radius_m

logger = logging.getLogger("kavach.sim")

# --------------------------------------------------------------------
# Tunables
# --------------------------------------------------------------------
BASE_INTERVAL_S = 3.0            # seconds between ticks at 1x (jittered +-20%)
MOVE_SIM_HOURS_PER_TICK = 0.75   # simulated hours of movement per tick (time compression)
CLOCK_MIN_PER_TICK = 10          # simulated wall-clock minutes per tick (drives day/night)
CLOCK_START_MIN = 19 * 60        # simulation starts at 19:00 (night monitoring)
HISTORY_POINTS = 40              # movement history kept per animal
SNAPSHOT_TRAIL_POINTS = 30       # trail points sent to the browser
RISK_HISTORY_POINTS = 20
EVENT_BUFFER = 300
SNAPSHOT_EVENTS = 25
SNAPSHOT_DETECTIONS = 40
MAX_DETECTIONS_PER_TICK = 3
RECENT_WINDOW_TICKS = 30         # "recent detections" feature window (~90 s at 1x)
ALERT_COOLDOWN_TICKS = 25        # per protected area
BOUNDARY_NEAR_KM = 1.0
HOTSPOT_DECAY_MULT = 0.985       # per idle tick
HOTSPOT_DECAY_SUB = 0.12
HOTSPOT_DELETE_BELOW = 10.0
SIM_DETECTION_KEEP = 1500
TRACK_KEEP_PER_ANIMAL = 60
NEAREST_FALLBACK_KM = 15.0
KM_PER_DEG_LAT = 111.32
EARTH_R_KM = 6371.0088

# Synthetic historical-conflict counts (0-6 scale used by the risk model) for the
# reserves the demo story centres on; every other reserve is seeded per-area.
HISTORICAL_CONFLICT_OVERRIDE = {"PA-TATR": 5, "PA-SGNP": 5, "PA-NNTR": 4, "PA-MELG": 4}

DEMO_CHOREOGRAPHY = os.environ.get("KAVACH_SIM_DEMO", "1") != "0"


# --------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------
def _iso(dt: Optional[datetime] = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def risk_level_from_score(score: float) -> str:
    # Same thresholds as gis.spatial.risk_level_from_score and predict.py.
    if score < 40:
        return "LOW"
    if score < 70:
        return "MEDIUM"
    return "HIGH"


def _km_per_deg_lng(lat: float) -> float:
    return KM_PER_DEG_LAT * math.cos(math.radians(lat))


def haversine_km(lat1, lng1, lat2, lng2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_KM * math.asin(min(1.0, math.sqrt(a)))


def bearing_deg(lat1, lng1, lat2, lng2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lng2 - lng1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def destination(lat, lng, bearing, dist_km):
    d = dist_km / EARTH_R_KM
    b = math.radians(bearing)
    p1, l1 = math.radians(lat), math.radians(lng)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1),
                         math.cos(d) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), (math.degrees(l2) + 540.0) % 360.0 - 180.0


def parse_ring(wkt: str):
    """'POLYGON((x y, x y, ...))' -> [(lng, lat), ...] (closed ring)."""
    body = wkt[wkt.index("((") + 2: wkt.rindex("))")]
    ring = []
    for pair in body.split(","):
        x, y = pair.strip().split()
        ring.append((float(x), float(y)))
    return ring


def point_in_ring(lng, lat, ring) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat):
            x_cross = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lng < x_cross:
                inside = not inside
        j = i
    return inside


def dist_to_ring_km(lat, lng, ring) -> float:
    """Distance from a point to the polygon boundary (local equirectangular km)."""
    kx = _km_per_deg_lng(lat)
    best = float("inf")
    for i in range(len(ring) - 1):
        ax, ay = (ring[i][0] - lng) * kx, (ring[i][1] - lat) * KM_PER_DEG_LAT
        bx, by = (ring[i + 1][0] - lng) * kx, (ring[i + 1][1] - lat) * KM_PER_DEG_LAT
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / seg2))
        px, py = ax + t * dx, ay + t * dy
        best = min(best, math.hypot(px, py))
    return best


_COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def compass(heading: float) -> str:
    return _COMPASS[int(((heading % 360) + 22.5) // 45) % 8]


# --------------------------------------------------------------------
# Protected-area context (built from the SAME seed data as PostGIS)
# --------------------------------------------------------------------
class PAContext:
    """Geometry + synthetic conflict context for one protected area.

    Polygons come from seed_protected_areas.polygon_from_centroid, i.e. the
    exact rings that are stored in PostGIS. The settlement, historical
    conflict count and environment level are SYNTHETIC simulation inputs
    (seeded per area so they are stable across runs).
    """

    def __init__(self, spec: dict):
        self.code = spec["code"]
        self.name = spec["name"]
        self.area_type = spec["area_type"]
        self.district = spec["district"]
        self.area_km2 = spec["area_km2"]
        self.primary_species = spec["primary_species"]
        self.lat, self.lng = spec["lat"], spec["lng"]
        self.ring = parse_ring(polygon_from_centroid(spec["lat"], spec["lng"], spec["area_km2"], spec["code"]))
        rng = random.Random(f"{self.code}-ctx")
        self.historical_conflicts = HISTORICAL_CONFLICT_OVERRIDE.get(self.code, rng.randint(1, 4))   # synthetic
        self.env_base = rng.randint(0, 2)               # synthetic
        ang = rng.uniform(0, 360)
        verts = self.ring[:-1]
        best = min(verts, key=lambda v: abs(((bearing_deg(self.lat, self.lng, v[1], v[0]) - ang + 540) % 360) - 180))
        b_lat, b_lng = best[1], best[0]
        out_bearing = bearing_deg(self.lat, self.lng, b_lat, b_lng)
        # synthetic settlement ~3 km outside the boundary
        self.settlement = destination(b_lat, b_lng, out_bearing, 3.0)
        # animals on a boundary-approach head for a point just inside the edge nearest it
        vert_km = max(0.5, haversine_km(self.lat, self.lng, b_lat, b_lng))
        frac = max(0.80, 1.0 - 0.4 / vert_km)          # stop ~0.4 km inside the boundary
        self.edge_target = (self.lat + (b_lat - self.lat) * frac, self.lng + (b_lng - self.lng) * frac)
        self.equiv_radius_km = math.sqrt(self.area_km2 / math.pi)

    def feature(self) -> dict:
        return {
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [[[x, y] for x, y in self.ring]]},
            "properties": {
                "code": self.code, "name": self.name, "area_type": self.area_type,
                "district": self.district, "official_area_km2": self.area_km2,
                "primary_species": self.primary_species,
            },
        }


def build_contexts() -> Dict[str, PAContext]:
    return {spec["code"]: PAContext(spec) for spec in PROTECTED_AREAS}


# --------------------------------------------------------------------
# Species behaviour profiles (demonstration behaviour, NOT claims about
# real animal behaviour)
# --------------------------------------------------------------------
SPECIES_PROFILES = {
    "Tiger": dict(code="TIGER", speed=(0.8, 2.6), turn=28, range_km=4.0, rest_p=0.12, edge_p=0.008, det_p=0.12, nocturnal=True),
    "Leopard": dict(code="LEOPARD", speed=(1.2, 3.6), turn=40, range_km=5.0, rest_p=0.08, edge_p=0.028, det_p=0.18, nocturnal=True),
    "Asian Elephant": dict(code="ELEPHANT", speed=(1.0, 3.4), turn=18, range_km=9.0, rest_p=0.06, edge_p=0.018, det_p=0.15, nocturnal=False),
    "Wild Boar": dict(code="WILDBOAR", speed=(0.5, 1.8), turn=60, range_km=1.6, rest_p=0.04, edge_p=0.020, det_p=0.30, nocturnal=True),
    "Spotted Deer": dict(code="DEER", speed=(0.6, 2.2), turn=45, range_km=2.5, rest_p=0.10, edge_p=0.006, det_p=0.20, nocturnal=False),
}

# species -> risk contribution used by the analytic fallback (mirrors ml/generate_dataset.py)
_SPECIES_RISK = {"Asian Elephant": 10, "Tiger": 12, "Leopard": 9, "Wild Boar": 7, "Spotted Deer": 3}

# (species, protected-area code, activation tick). Leading entries appear first
# so a demo shows: tiger -> elephants -> leopard -> ... within the first minute.
ANIMAL_PLAN = [
    ("Tiger", "PA-TATR", 0),
    ("Asian Elephant", "PA-NNTR", 3),
    ("Asian Elephant", "PA-NNTR", 4),      # herd-mate of the previous elephant
    ("Leopard", "PA-SGNP", 6),
    ("Wild Boar", "PA-BOR", 8),
    ("Spotted Deer", "PA-KARN", 10),
    ("Spotted Deer", "PA-KARN", 11),       # herd-mate
    ("Tiger", "PA-TATR", 12),
    ("Leopard", "PA-SGNP", 14),
    ("Wild Boar", "PA-UMKA", 16),
    ("Tiger", "PA-MELG", 18),
    ("Leopard", "PA-KOKA", 20),
    ("Wild Boar", "PA-SGNP", 22),
    ("Spotted Deer", "PA-KOKA", 24),
    ("Asian Elephant", "PA-TATR", 26),
    ("Tiger", "PA-PENC", 28),
]
# animals that are herd-mates: same species + same protected area share a leader
GROUPED_SPECIES = {"Asian Elephant", "Spotted Deer"}

# scripted boundary approaches so the demo tells the conflict story quickly
DEMO_EDGE_TICKS = {"SIM-TIGER-001": 14, "SIM-LEOPARD-001": 20, "SIM-ELEPHANT-001": 30}


def activity_factor(species: str, hour: float) -> float:
    prof = SPECIES_PROFILES[species]
    night = hour >= 19 or hour < 5
    twilight = 5 <= hour < 8 or 17 <= hour < 19
    if prof["nocturnal"]:
        return 1.0 if night else 0.7 if twilight else 0.55
    return 1.0 if twilight else 0.8 if not night else 0.6


# --------------------------------------------------------------------
# Risk scoring: real ML model when registered by predict.py
# --------------------------------------------------------------------
_risk_batch_fn: Optional[Callable[[List[dict]], List[float]]] = None
_risk_warned = False


def register_risk_predictor(fn: Callable[[List[dict]], List[float]]) -> None:
    """predict.py registers a batch wrapper around the REAL risk_model.pkl."""
    global _risk_batch_fn
    _risk_batch_fn = fn


def analytic_risk(f: dict) -> float:
    """Noise-free version of the formula the ML model was trained on
    (ml/generate_dataset.py). Used only if the ML model isn't registered."""
    score = (
        (f["yolo_confidence"] - 60) / 39 * 5
        + f["recent_detections"] / 20 * 20
        + f["historical_conflicts"] / 6 * 20
        + f["settlement_proximity"] / 2 * 15
        + f["temporal_pattern"] / 2 * 10
        + f["environmental_context"] / 2 * 10
        + f["spatial_relationship"] / 2 * 10
        + _SPECIES_RISK.get(f["species"], 0)
    )
    return max(0.0, min(100.0, score))


def predict_risk_batch(rows: List[dict]):
    global _risk_warned
    if not rows:
        return [], ("ml_model" if _risk_batch_fn else "analytic_fallback")
    if _risk_batch_fn is not None:
        try:
            return [max(0.0, min(100.0, float(x))) for x in _risk_batch_fn(rows)], "ml_model"
        except Exception as e:  # noqa: BLE001
            if not _risk_warned:
                logger.warning("ML risk model failed inside simulator (%s); using analytic fallback", e)
                _risk_warned = True
    return [analytic_risk(r) for r in rows], "analytic_fallback"


# --------------------------------------------------------------------
# Simulated animal
# --------------------------------------------------------------------
class SimAnimal:
    def __init__(self, animal_id, species, pa_code, activate_tick, lat, lng, heading):
        self.id = animal_id
        self.species = species
        self.pa_code = pa_code
        self.activate_tick = activate_tick
        self.active = False
        self.lat, self.lng = lat, lng
        self.prev_lat, self.prev_lng = lat, lng
        self.heading = heading
        self.speed = 0.0
        self.confidence = 90.0
        self.risk_score = 0.0
        self.risk_level = "LOW"
        self.prev_level = "LOW"
        self.has_risk = False
        self.state = "foraging"
        self.rest_ticks = 0
        self.waypoint = None
        self.leader: Optional["SimAnimal"] = None
        self.boundary_km = 99.0
        self.settlement_km = 99.0
        self.near_boundary = False
        self.detections = 0
        self.last_seen: Optional[str] = None
        self.updated_at = _iso()
        self.history = deque(maxlen=HISTORY_POINTS)          # (lat, lng, iso, risk)
        self.risk_history = deque(maxlen=RISK_HISTORY_POINTS)


# --------------------------------------------------------------------
# Stores: same interface, PostGIS or in-memory
# --------------------------------------------------------------------
def _det_feature(d: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [d["lng"], d["lat"]]},
        "properties": {
            "id": d["id"], "zone_code": d.get("zone_code"), "species": d["species"],
            "confidence": d["confidence"], "risk_score": d["risk_score"], "risk_level": d["risk_level"],
            "protected_area_name": d.get("pa_name"), "protected_area_code": d.get("pa_code"),
            "detected_at": d["detected_at"], "source": d.get("source", "real"),
        },
    }


def _hot_feature(h: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [h["lng"], h["lat"]]},
        "properties": {
            "id": h["id"], "risk_score": round(float(h["risk_score"]), 2), "risk_level": h["risk_level"],
            "species": h["species"], "detection_count": h["detection_count"], "radius_m": h["radius_m"],
            "protected_area_name": h.get("pa_name"), "protected_area_code": h.get("pa_code"),
            "updated_at": h["updated_at"], "source": h.get("source", "real"),
        },
    }


def _fc(features: list) -> dict:
    return {"type": "FeatureCollection", "features": features}


class MemoryStore:
    """In-memory mirror of the PostGIS pipeline. Used when PostGIS is
    unavailable ("GIS OFFLINE / SIMULATION LOCAL") so the demo still runs."""

    mode = "memory"

    def __init__(self, contexts: Dict[str, PAContext]):
        self.contexts = contexts
        self._det_ids = itertools.count(1)
        self._hs_ids = itertools.count(1)
        self.detections: deque = deque(maxlen=SIM_DETECTION_KEEP)
        self.hotspots: Dict[int, dict] = {}

    def reset(self):
        self.detections.clear()
        self.hotspots.clear()

    # -- spatial resolve (ST_Contains / nearest-within-15km equivalent) --
    def resolve(self, lat, lng) -> Optional[PAContext]:
        for ctx in self.contexts.values():
            if point_in_ring(lng, lat, ctx.ring):
                return ctx
        best, best_d = None, NEAREST_FALLBACK_KM
        for ctx in self.contexts.values():
            d = dist_to_ring_km(lat, lng, ctx.ring)
            if d <= best_d:
                best, best_d = ctx, d
        return best

    def record_detection(self, *, species, confidence, risk_score, lat, lng, zone_code=None):
        ctx = self.resolve(lat, lng)
        now = _iso()
        det = {
            "id": next(self._det_ids), "species": species, "confidence": round(confidence, 2),
            "risk_score": round(risk_score, 2), "risk_level": risk_level_from_score(risk_score),
            "lat": lat, "lng": lng, "detected_at": now, "ts": time.time(), "source": "simulation",
            "pa_code": ctx.code if ctx else None, "pa_name": ctx.name if ctx else None,
        }
        self.detections.append(det)

        pa_code = ctx.code if ctx else None
        near, near_d = None, None
        for h in self.hotspots.values():
            if h["pa_code"] != pa_code:
                continue
            d = haversine_km(h["lat"], h["lng"], lat, lng) * 1000
            if d <= SIM_HOTSPOT_CLUSTER_RADIUS_M and (near_d is None or d < near_d):
                near, near_d = h, d
        if near:
            n = near["detection_count"] + 1
            near["lat"] = (near["lat"] * near["detection_count"] + lat) / n
            near["lng"] = (near["lng"] * near["detection_count"] + lng) / n
            near["risk_score"] = sim_blend_score(near["risk_score"], risk_score, n)
            near["risk_level"] = risk_level_from_score(near["risk_score"])
            near["detection_count"] = n
            near["radius_m"] = sim_radius_m(near["risk_score"])
            near["species"] = species
            near["updated_at"] = now
            hs = near
        else:
            hid = next(self._hs_ids)
            hs = {
                "id": hid, "pa_code": pa_code, "pa_name": ctx.name if ctx else None,
                "risk_score": risk_score, "risk_level": risk_level_from_score(risk_score),
                "species": species, "detection_count": 1, "radius_m": sim_radius_m(risk_score),
                "lat": lat, "lng": lng, "updated_at": now, "source": "simulation",
            }
            self.hotspots[hid] = hs
        return {
            "detection_id": det["id"], "detected_at": now,
            "protected_area": {"code": ctx.code, "name": ctx.name} if ctx else None,
            "hotspot": {"id": hs["id"], "risk_score": hs["risk_score"], "risk_level": hs["risk_level"],
                        "detection_count": hs["detection_count"], "radius_m": hs["radius_m"]},
        }

    def finish_tick(self, animals, new_events, touched, tick):
        for hid in list(self.hotspots):
            h = self.hotspots[hid]
            if hid in touched:
                continue
            h["risk_score"] = max(0.0, h["risk_score"] * HOTSPOT_DECAY_MULT - HOTSPOT_DECAY_SUB)
            h["risk_level"] = risk_level_from_score(h["risk_score"])
            h["radius_m"] = sim_radius_m(h["risk_score"])
            if tick % 10 == 0:
                h["detection_count"] = max(1, h["detection_count"] - 1)
            if h["risk_score"] < HOTSPOT_DELETE_BELOW:
                del self.hotspots[hid]
        hot = sorted(self.hotspots.values(), key=lambda h: -h["risk_score"])
        zones = {}
        recent_by_pa: Dict[str, int] = {}
        cutoff = time.time() - 60
        for d in reversed(self.detections):          # newest first, stop at the 60 s horizon
            if d["ts"] < cutoff:
                break
            recent_by_pa[d["pa_code"]] = recent_by_pa.get(d["pa_code"], 0) + 1
        for ctx in self.contexts.values():
            mine = [h for h in hot if h["pa_code"] == ctx.code]
            score = max((h["risk_score"] for h in mine), default=0.0)
            recent = recent_by_pa.get(ctx.code, 0)
            zones[ctx.code] = {
                "risk_score": round(score, 2),
                "risk_level": risk_level_from_score(score) if score > 0 else "LOW",
                "detection_count": int(sum(h["detection_count"] for h in mine)),
                "recent_detections": recent,
            }
        dets = list(self.detections)[-SNAPSHOT_DETECTIONS:][::-1]
        return {
            "hotspots": _fc([_hot_feature(h) for h in hot]),
            "detections": _fc([_det_feature(d) for d in dets]),
            "zones": zones,
        }


class PostGISStore:
    """Writes the simulation through the existing GIS pipeline
    (gis.spatial.record_detection) and persists animals / tracks / events."""

    mode = "postgis"

    def __init__(self, contexts: Dict[str, PAContext]):
        from .database import get_connection, dict_cursor, ensure_simulation_schema
        self._get_connection, self._dict_cursor = get_connection, dict_cursor
        if not ensure_simulation_schema():
            raise RuntimeError("could not apply simulation schema")
        conn = get_connection()
        try:
            with dict_cursor(conn) as cur:
                cur.execute("SELECT id, code FROM protected_areas")
                self.pa_ids = {r["code"]: r["id"] for r in cur.fetchall()}
        finally:
            conn.close()
        if not self.pa_ids:
            raise RuntimeError("protected_areas is empty - run: python -m gis.seed_protected_areas")
        self.contexts = contexts

    def reset(self):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM detections WHERE source = 'simulation'")
                cur.execute("DELETE FROM hotspots WHERE source = 'simulation'")
                cur.execute("DELETE FROM simulation_tracks")
                cur.execute("DELETE FROM simulation_events")
                cur.execute("DELETE FROM simulation_animals")
            conn.commit()
        finally:
            conn.close()

    def record_detection(self, *, species, confidence, risk_score, lat, lng, zone_code=None):
        from .spatial import record_detection
        res = record_detection(species=species, confidence=confidence, risk_score=risk_score,
                               lat=lat, lng=lng, zone_code=zone_code, source="simulation")
        pa = res.get("protected_area")
        if pa:
            res["protected_area"] = {"code": pa["code"], "name": pa["name"]}
        hs = res.get("hotspot") or {}
        if hs:
            hs["risk_score"] = float(hs["risk_score"])
        return res

    def finish_tick(self, animals, new_events, touched, tick):
        from psycopg2.extras import execute_values
        conn = self._get_connection()
        try:
            with self._dict_cursor(conn) as cur:
                # 1) animals + tracks
                rows = [
                    (a.id, a.species, a.lat, a.lng, a.prev_lat, a.prev_lng, a.heading, a.speed,
                     round(a.confidence, 2), round(a.risk_score, 2), a.risk_level,
                     self.pa_ids.get(a.pa_code), a.state, a.active, a.lng, a.lat)
                    for a in animals if a.active
                ]
                if rows:
                    execute_values(
                        cur,
                        """
                        INSERT INTO simulation_animals
                            (id, species, lat, lng, previous_lat, previous_lng, heading, speed,
                             confidence, risk_score, risk_level, protected_area_id, state, active,
                             geom, updated_at)
                        VALUES %s
                        ON CONFLICT (id) DO UPDATE SET
                            lat = EXCLUDED.lat, lng = EXCLUDED.lng,
                            previous_lat = EXCLUDED.previous_lat, previous_lng = EXCLUDED.previous_lng,
                            heading = EXCLUDED.heading, speed = EXCLUDED.speed,
                            confidence = EXCLUDED.confidence, risk_score = EXCLUDED.risk_score,
                            risk_level = EXCLUDED.risk_level, protected_area_id = EXCLUDED.protected_area_id,
                            state = EXCLUDED.state, active = EXCLUDED.active,
                            geom = EXCLUDED.geom, updated_at = now()
                        """,
                        rows,
                        template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,ST_SetSRID(ST_MakePoint(%s,%s),4326),now())",
                    )
                    execute_values(
                        cur,
                        "INSERT INTO simulation_tracks (animal_id, lat, lng, risk_score) VALUES %s",
                        [(r[0], r[2], r[3], r[9]) for r in rows],
                    )
                # 2) events
                if new_events:
                    execute_values(
                        cur,
                        """INSERT INTO simulation_events
                           (animal_id, event_type, species, lat, lng, risk_score, risk_level, message, "timestamp")
                           VALUES %s""",
                        [(e["animal_id"], e["event_type"], e["species"], e["lat"], e["lng"],
                          e["risk_score"], e["risk_level"], e["message"], e["timestamp"]) for e in new_events],
                    )
                # 3) hotspot decay for clusters that saw no detection this tick
                touched_list = list(touched)
                cur.execute(
                    "SELECT id, risk_score FROM hotspots "
                    "WHERE source = 'simulation' AND NOT (id = ANY(%s::int[]))",
                    (touched_list,),
                )
                upd = []
                for r in cur.fetchall():
                    nr = max(0.0, float(r["risk_score"]) * HOTSPOT_DECAY_MULT - HOTSPOT_DECAY_SUB)
                    upd.append((r["id"], round(nr, 2), risk_level_from_score(nr), sim_radius_m(nr)))
                if upd:
                    execute_values(
                        cur,
                        "UPDATE hotspots h SET risk_score = v.s, risk_level = v.l, radius_m = v.r "
                        "FROM (VALUES %s) AS v(id, s, l, r) WHERE h.id = v.id",
                        upd, template="(%s::int, %s::numeric, %s::text, %s::int)",
                    )
                if tick % 10 == 0:
                    cur.execute(
                        "UPDATE hotspots SET detection_count = GREATEST(1, detection_count - 1) "
                        "WHERE source = 'simulation' AND NOT (id = ANY(%s::int[]))", (touched_list,))
                cur.execute(
                    "DELETE FROM hotspots WHERE source = 'simulation' AND risk_score < %s "
                    "AND NOT (id = ANY(%s::int[]))", (HOTSPOT_DELETE_BELOW, touched_list))
                # 4) bounded history
                if tick % 25 == 0:
                    cur.execute(
                        "DELETE FROM simulation_tracks t USING ("
                        " SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY animal_id ORDER BY id DESC) rn "
                        " FROM simulation_tracks) x WHERE rn > %s) d WHERE t.id = d.id", (TRACK_KEEP_PER_ANIMAL,))
                    cur.execute(
                        "DELETE FROM simulation_events WHERE id < (SELECT COALESCE(MAX(id), 0) - 500 FROM simulation_events)")
                    cur.execute(
                        "DELETE FROM detections WHERE source = 'simulation' AND id NOT IN "
                        "(SELECT id FROM detections WHERE source = 'simulation' ORDER BY id DESC LIMIT %s)",
                        (SIM_DETECTION_KEEP,))
                parts = self._read(cur)
            conn.commit()
            return parts
        finally:
            conn.close()

    def _read(self, cur):
        cur.execute(
            """
            SELECT h.id, h.risk_score, h.risk_level, h.species, h.detection_count, h.radius_m,
                   h.updated_at, h.source, pa.name AS pa_name, pa.code AS pa_code,
                   ST_X(h.geom) AS lng, ST_Y(h.geom) AS lat
            FROM hotspots h LEFT JOIN protected_areas pa ON pa.id = h.protected_area_id
            ORDER BY h.risk_score DESC
            """
        )
        hot = []
        for r in cur.fetchall():
            r = dict(r)
            r["updated_at"] = r["updated_at"].isoformat()
            hot.append(_hot_feature(r))
        cur.execute(
            """
            SELECT d.id, d.zone_code, d.species, d.confidence, d.risk_score, d.risk_level, d.detected_at,
                   d.source, pa.name AS pa_name, pa.code AS pa_code,
                   ST_X(d.geom) AS lng, ST_Y(d.geom) AS lat
            FROM detections d LEFT JOIN protected_areas pa ON pa.id = d.protected_area_id
            ORDER BY d.detected_at DESC, d.id DESC LIMIT 40
            """
        )
        dets = []
        for r in cur.fetchall():
            r = dict(r)
            r["detected_at"] = r["detected_at"].isoformat()
            r["confidence"] = float(r["confidence"])
            r["risk_score"] = float(r["risk_score"]) if r["risk_score"] is not None else None
            dets.append(_det_feature(r))
        cur.execute(
            """
            SELECT pa.code,
                   COALESCE(MAX(h.risk_score), 0) AS rs,
                   COALESCE(SUM(h.detection_count), 0) AS dc,
                   (SELECT COUNT(*) FROM detections d
                     WHERE d.protected_area_id = pa.id
                       AND d.detected_at > now() - interval '60 seconds') AS recent
            FROM protected_areas pa LEFT JOIN hotspots h ON h.protected_area_id = pa.id
            GROUP BY pa.id
            """
        )
        zones = {}
        for r in cur.fetchall():
            score = float(r["rs"])
            zones[r["code"]] = {
                "risk_score": round(score, 2),
                "risk_level": risk_level_from_score(score) if score > 0 else "LOW",
                "detection_count": int(r["dc"]), "recent_detections": int(r["recent"]),
            }
        return {"hotspots": _fc(hot), "detections": _fc(dets), "zones": zones}


# --------------------------------------------------------------------
# The simulator
# --------------------------------------------------------------------
class Simulator:
    def __init__(self, seed: Optional[int] = None):
        self.contexts = build_contexts()
        self._seed = seed if seed is not None else (int(os.environ["KAVACH_SIM_SEED"]) if os.environ.get("KAVACH_SIM_SEED") else None)
        self._lock = threading.RLock()        # short: guards published state
        self._tick_lock = threading.Lock()    # serialises ticks / reset
        self._run = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._probe_thread: Optional[threading.Thread] = None
        self.speed = 1.0
        self.demo = DEMO_CHOREOGRAPHY
        self.store = None
        self.db_ok = False
        self.db_error: Optional[str] = None
        self._geometry_fc = _fc([c.feature() for c in self.contexts.values()])
        self._init_state()
        self._start_probe()

    # ---------------- state ----------------
    def _init_state(self):
        with self._lock:
            self._rng = random.Random(self._seed)
            self.tick = 0
            self.clock_min = CLOCK_START_MIN
            self.version = 0
            self.risk_source = "ml_model" if _risk_batch_fn else "analytic_fallback"
            self.events: deque = deque(maxlen=EVENT_BUFFER)
            self._seq = 0
            self._events_total = 0
            self._det_times: deque = deque(maxlen=400)     # wall-clock times of detections
            self._pa_recent: Dict[str, deque] = {c: deque(maxlen=64) for c in self.contexts}
            self._hs_level: Dict[int, str] = {}
            self._hs_hist: Dict[int, deque] = {}
            self._alert_cool: Dict[str, int] = {}
            self._last_detection: Optional[dict] = None
            self.started_at: Optional[str] = None
            self._parts = {"hotspots": _fc([]), "detections": _fc([]), "zones": {}}
            self.animals: List[SimAnimal] = self._spawn()
            self._animals_fc = self._build_animals_fc()

    def _spawn(self) -> List[SimAnimal]:
        counters: Dict[str, int] = {}
        animals: List[SimAnimal] = []
        leaders: Dict[tuple, SimAnimal] = {}
        for species, pa_code, act_tick in ANIMAL_PLAN:
            prof = SPECIES_PROFILES[species]
            counters[prof["code"]] = counters.get(prof["code"], 0) + 1
            aid = f"SIM-{prof['code']}-{counters[prof['code']]:03d}"
            ctx = self.contexts[pa_code]
            lat, lng = self._spawn_point(ctx, aid)
            a = SimAnimal(aid, species, pa_code, act_tick, lat, lng, self._rng.uniform(0, 360))
            if species in GROUPED_SPECIES:
                key = (species, pa_code)
                if key in leaders:
                    a.leader = leaders[key]
                else:
                    leaders[key] = a
            animals.append(a)
        return animals

    def _spawn_point(self, ctx: PAContext, aid: str):
        rng = self._rng
        if aid == "SIM-TIGER-001":
            # demo tiger starts ~55% of the way toward the edge nearest the synthetic settlement
            return (ctx.lat + (ctx.edge_target[0] - ctx.lat) * 0.55,
                    ctx.lng + (ctx.edge_target[1] - ctx.lng) * 0.55)
        for _ in range(30):
            d = rng.uniform(0.0, ctx.equiv_radius_km * 0.45)
            lat, lng = destination(ctx.lat, ctx.lng, rng.uniform(0, 360), d)
            if point_in_ring(lng, lat, ctx.ring):
                return lat, lng
        return ctx.lat, ctx.lng

    # ---------------- db probe ----------------
    def _start_probe(self):
        def probe():
            while True:
                try:
                    from .database import is_available
                    ok = is_available()
                    self.db_ok = ok
                except Exception as e:  # noqa: BLE001
                    self.db_ok = False
                    self.db_error = str(e)
                time.sleep(8.0)
        self._probe_thread = threading.Thread(target=probe, name="kavach-sim-dbprobe", daemon=True)
        self._probe_thread.start()

    def _ensure_store(self):
        """Pick PostGIS when reachable+seeded, else the in-memory store."""
        if self.store is not None:
            return
        try:
            from .database import is_available
            if not is_available():
                raise RuntimeError("PostGIS unreachable")
            self.store = PostGISStore(self.contexts)
            self.db_error = None
        except Exception as e:  # noqa: BLE001
            self.db_error = str(e)
            self.store = MemoryStore(self.contexts)
            logger.warning("Simulation running in LOCAL memory mode: %s", e)
        try:
            self.store.reset()   # drop stale rows from a previous process
        except Exception as e:  # noqa: BLE001
            self._degrade(e)

    def _degrade(self, err):
        """PostGIS failed mid-run -> keep the demo alive in memory."""
        logger.warning("PostGIS error, switching simulation to LOCAL memory: %s", err)
        self.db_error = str(err)
        self.store = MemoryStore(self.contexts)

    # ---------------- control ----------------
    def start(self):
        with self._tick_lock:
            self._ensure_store()
        with self._lock:
            if self.started_at is None:
                self.started_at = _iso()
            self._run.set()
            self.version += 1
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._loop, name="kavach-sim", daemon=True)
            self._thread.start()
        return self.status()

    def stop(self):
        self._run.clear()
        with self._lock:
            self.version += 1
        return self.status()

    def set_speed(self, value: float):
        with self._lock:
            self.speed = max(0.25, min(8.0, float(value)))
            self.version += 1
        return self.status()

    def reset(self):
        was_running = self._run.is_set()
        self._run.clear()
        with self._tick_lock:          # waits for an in-flight tick
            self._init_state()
            self.store = None
            self._ensure_store()
            with self._lock:
                self.version += 1
        if was_running:
            self.start()
        return self.status()

    # ---------------- worker ----------------
    def _loop(self):
        while True:
            self._run.wait()
            began = time.monotonic()
            try:
                with self._tick_lock:
                    if self._run.is_set():
                        self._tick_once()
            except Exception:  # noqa: BLE001
                logger.exception("simulation tick failed")
                time.sleep(1.0)
            interval = (BASE_INTERVAL_S * self._rng.uniform(0.8, 1.2)) / self.speed
            deadline = began + interval
            while self._run.is_set() and time.monotonic() < deadline:
                time.sleep(0.05)

    # ---------------- one tick ----------------
    def _hour(self) -> float:
        return (self.clock_min / 60.0) % 24

    def _tick_once(self):
        rng = self._rng
        # --- phase A (lock): movement + features ---------------------
        with self._lock:
            self.tick += 1
            tick = self.tick
            self.clock_min += CLOCK_MIN_PER_TICK
            hour = self._hour()
            for a in self.animals:
                if not a.active and tick >= a.activate_tick:
                    a.active = True
            active = [a for a in self.animals if a.active]
            for a in active:
                a.confidence = max(78.0, min(98.0, rng.gauss(90, 5)))
                self._move(a, hour)
            features = [self._features(a, hour, tick) for a in active]

        # --- phase B (no lock): risk model ----------------------------
        risks, source = predict_risk_batch(features)

        # --- phase C (lock): apply risk, choose detections ------------
        new_events: List[dict] = []
        with self._lock:
            self.risk_source = source
            iso_now = _iso()
            for a, r in zip(active, risks):
                a.prev_level = a.risk_level
                a.risk_score = round(r if not a.has_risk else 0.5 * a.risk_score + 0.5 * r, 1)
                a.has_risk = True
                a.risk_level = risk_level_from_score(a.risk_score)
                a.updated_at = iso_now
                a.history.append((a.lat, a.lng, iso_now, a.risk_score))
                a.risk_history.append(a.risk_score)
                if a.boundary_km < BOUNDARY_NEAR_KM and not a.near_boundary:
                    a.near_boundary = True
                    new_events.append(self._event("BOUNDARY", a, iso_now,
                                                  f"{a.species} approaching {self.contexts[a.pa_code].name} boundary"))
                elif a.boundary_km > BOUNDARY_NEAR_KM + 1.0:
                    a.near_boundary = False
            chosen = self._choose_detectors(active, hour)

        # --- phase D (no lock): the real GIS pipeline -----------------
        results = []
        for a in chosen:
            payload = dict(species=a.species, confidence=round(a.confidence, 2),
                           risk_score=a.risk_score, lat=a.lat, lng=a.lng, zone_code=None)
            try:
                res = self.store.record_detection(**payload)
            except Exception as e:  # noqa: BLE001
                self._degrade(e)
                res = self.store.record_detection(**payload)
            results.append((a, res))

        # --- phase E (lock): events + alerts --------------------------
        touched = set()
        with self._lock:
            wall = time.time()
            for a, res in results:
                hs = res.get("hotspot") or {}
                pa = res.get("protected_area") or {"code": a.pa_code, "name": self.contexts[a.pa_code].name}
                a.detections += 1
                a.last_seen = res.get("detected_at") or _iso()
                if hs.get("id") is not None:
                    touched.add(int(hs["id"]))
                self._pa_recent[a.pa_code].append(tick)
                self._det_times.append(wall)
                ev = self._event("DETECTION", a, a.last_seen,
                                 f"{a.species} detected in {pa['name']}",
                                 hotspot=hs, detection_id=res.get("detection_id"))
                new_events.append(ev)
                self._last_detection = {k: ev[k] for k in ("seq", "species", "animal_id", "protected_area", "risk_score", "risk_level", "timestamp")}
                alert = self._maybe_alert(a, hs, pa, tick)
                if alert:
                    new_events.append(alert)
            for ev in new_events:
                self.events.appendleft(ev)
                self._events_total += 1

        # --- phase F (no lock): persist + read back -------------------
        try:
            parts = self.store.finish_tick(self.animals, new_events, touched, tick)
        except Exception as e:  # noqa: BLE001
            self._degrade(e)
            parts = self.store.finish_tick(self.animals, new_events, touched, tick)

        # --- phase G (lock): publish ----------------------------------
        with self._lock:
            self._decorate_trends(parts)
            self._parts = parts
            self._animals_fc = self._build_animals_fc()
            self.version += 1

    # ---------------- behaviour ----------------
    def _pick_waypoint(self, a: SimAnimal):
        ctx, prof, rng = self.contexts[a.pa_code], SPECIES_PROFILES[a.species], self._rng
        for _ in range(16):
            lat, lng = destination(a.lat, a.lng, rng.uniform(0, 360), rng.uniform(0.3, prof["range_km"]))
            if point_in_ring(lng, lat, ctx.ring) and dist_to_ring_km(lat, lng, ctx.ring) > 0.4:
                return (lat, lng)
        return (ctx.lat, ctx.lng)

    def _begin_edge(self, a: SimAnimal):
        a.state = "edge_approach"
        a.waypoint = self.contexts[a.pa_code].edge_target

    def _move(self, a: SimAnimal, hour: float):
        ctx, prof, rng = self.contexts[a.pa_code], SPECIES_PROFILES[a.species], self._rng
        a.prev_lat, a.prev_lng = a.lat, a.lng
        act = activity_factor(a.species, hour)
        is_follower = a.leader is not None and a.leader.active

        # scripted conflict story for the demo
        if (self.demo and DEMO_EDGE_TICKS.get(a.id) == self.tick
                and a.state not in ("edge_approach", "edge_hold")):
            self._begin_edge(a)

        if is_follower:
            a.state = "following"
            a.waypoint = destination(a.leader.lat, a.leader.lng, rng.uniform(0, 360), rng.uniform(0.15, 0.5))
        elif a.state == "following":
            a.state, a.waypoint = "foraging", None

        if a.state == "resting":
            a.rest_ticks -= 1
            a.speed = round(rng.uniform(0.0, 0.3), 2)
            if a.rest_ticks <= 0:
                a.state, a.waypoint = "foraging", None
            self._post_move(a, ctx)
            return
        if a.state == "edge_hold":
            a.rest_ticks -= 1
            a.speed = round(rng.uniform(0.2, 0.7), 2)
            cand = destination(a.lat, a.lng, rng.uniform(0, 360), 0.08)
            if point_in_ring(cand[1], cand[0], ctx.ring):
                a.lat, a.lng = cand
            if a.rest_ticks <= 0:
                a.state = "foraging"
                a.waypoint = self._pick_waypoint(a)
            self._post_move(a, ctx)
            return
        if a.state == "foraging" and not is_follower and rng.random() < prof["edge_p"]:
            self._begin_edge(a)
        if a.waypoint is None:
            a.waypoint = self._pick_waypoint(a)

        wlat, wlng = a.waypoint
        desired = bearing_deg(a.lat, a.lng, wlat, wlng)
        diff = ((desired - a.heading + 540) % 360) - 180
        turn = max(-prof["turn"], min(prof["turn"], diff)) + rng.gauss(0, prof["turn"] * 0.2)
        a.heading = (a.heading + turn) % 360
        speed = max(0.25, rng.uniform(*prof["speed"]) * act)
        if a.state == "edge_approach":
            speed = max(speed, prof["speed"][1] * 0.9)      # purposeful movement
        if is_follower:
            speed *= 1.25
        step_km = speed * MOVE_SIM_HOURS_PER_TICK
        d_wp = haversine_km(a.lat, a.lng, wlat, wlng)
        arrived = d_wp <= step_km
        if arrived:
            nlat, nlng = wlat, wlng
            speed = d_wp / MOVE_SIM_HOURS_PER_TICK
        else:
            nlat, nlng = destination(a.lat, a.lng, a.heading, step_km)
        if not point_in_ring(nlng, nlat, ctx.ring):
            # keep animals inside their reserve: turn toward the interior, shorter step
            a.heading = (bearing_deg(a.lat, a.lng, ctx.lat, ctx.lng) + rng.gauss(0, 20)) % 360
            nlat, nlng = destination(a.lat, a.lng, a.heading, step_km * 0.6)
            if not point_in_ring(nlng, nlat, ctx.ring):
                nlat, nlng, speed = a.lat, a.lng, 0.2
            arrived = False
            if not is_follower and a.state != "edge_approach":
                a.waypoint = None
        a.lat, a.lng = nlat, nlng
        a.speed = round(speed, 2)
        if arrived:
            if a.state == "edge_approach":
                a.state, a.rest_ticks = "edge_hold", rng.randint(4, 8)
            elif a.state == "foraging":
                if rng.random() < prof["rest_p"]:
                    a.state, a.rest_ticks = "resting", rng.randint(2, 5)
                else:
                    a.waypoint = None
        self._post_move(a, ctx)

    def _post_move(self, a: SimAnimal, ctx: PAContext):
        a.boundary_km = dist_to_ring_km(a.lat, a.lng, ctx.ring) if point_in_ring(a.lng, a.lat, ctx.ring) else 0.0
        a.settlement_km = haversine_km(a.lat, a.lng, ctx.settlement[0], ctx.settlement[1])

    def _features(self, a: SimAnimal, hour: float, tick: int) -> dict:
        ctx = self.contexts[a.pa_code]
        recent = sum(1 for t in self._pa_recent[a.pa_code] if tick - t <= RECENT_WINDOW_TICKS) + 1
        settle = 2 if a.settlement_km < 3.6 else 1 if a.settlement_km < 8.0 else 0
        temporal = 2 if (hour >= 19 or hour < 5) else 1 if (5 <= hour < 8 or 17 <= hour < 19) else 0
        spatial = 2 if a.boundary_km < 1.0 else 1 if a.boundary_km < 3.5 else 0
        env = min(2, ctx.env_base + (1 if a.boundary_km < 1.0 else 0))
        return {
            "species": a.species,
            "yolo_confidence": round(a.confidence, 2),
            "recent_detections": min(20, recent),
            "historical_conflicts": ctx.historical_conflicts,
            "settlement_proximity": settle,
            "temporal_pattern": temporal,
            "environmental_context": env,
            "spatial_relationship": spatial,
        }

    def _choose_detectors(self, active: List[SimAnimal], hour: float) -> List[SimAnimal]:
        rng = self._rng
        if not active:
            return []
        weights = []
        for a in active:
            w = SPECIES_PROFILES[a.species]["det_p"] * activity_factor(a.species, hour)
            if a.state in ("edge_approach", "edge_hold"):
                w *= 2.5
            weights.append(w)
        chosen = [a for a, w in zip(active, weights) if rng.random() < w]
        rng.shuffle(chosen)
        chosen = chosen[:MAX_DETECTIONS_PER_TICK]
        if not chosen:   # always keep the feed alive while running
            chosen = [rng.choices(active, weights=weights)[0]]
        return chosen

    # ---------------- events / alerts ----------------
    def _event(self, etype, a: SimAnimal, ts, message, hotspot=None, detection_id=None, detail=None) -> dict:
        self._seq += 1
        ctx = self.contexts[a.pa_code]
        return {
            "seq": self._seq, "event_type": etype, "animal_id": a.id, "species": a.species,
            "protected_area": ctx.name, "protected_area_code": ctx.code,
            "lat": round(a.lat, 5), "lng": round(a.lng, 5),
            "risk_score": round(a.risk_score, 1), "risk_level": a.risk_level,
            "confidence": round(a.confidence, 1), "timestamp": ts, "message": message,
            "detection_id": detection_id,
            "hotspot_id": (hotspot or {}).get("id"),
            "detection_count": (hotspot or {}).get("detection_count"),
            "detail": detail or {}, "simulated": True,
        }

    def _trend_for(self, hid, score) -> str:
        hist = self._hs_hist.get(hid)
        if not hist:
            return "Increasing"
        ref = hist[-4] if len(hist) >= 4 else hist[0]
        return "Increasing" if score > ref + 2 else "Decreasing" if score < ref - 2 else "Stable"

    def _maybe_alert(self, a: SimAnimal, hs: dict, pa: dict, tick: int) -> Optional[dict]:
        hid = hs.get("id")
        new_level = hs.get("risk_level") or a.risk_level
        prev_hs_level = self._hs_level.get(hid) if hid is not None else None
        if hid is not None:
            self._hs_level[hid] = new_level
        crossed_hotspot = new_level == "HIGH" and prev_hs_level != "HIGH"
        crossed_animal = a.risk_level == "HIGH" and a.prev_level != "HIGH"
        if not (crossed_hotspot or crossed_animal):
            return None
        if tick - self._alert_cool.get(a.pa_code, -10_000) < ALERT_COOLDOWN_TICKS:
            return None
        self._alert_cool[a.pa_code] = tick
        if crossed_hotspot:
            score, trend = float(hs.get("risk_score") or a.risk_score), self._trend_for(hid, float(hs.get("risk_score") or 0))
        else:
            score = a.risk_score
            rh = list(a.risk_history)
            ref = rh[-4] if len(rh) >= 4 else (rh[0] if rh else score)
            trend = "Increasing" if score > ref + 2 else "Decreasing" if score < ref - 2 else "Stable"
        where = f"near {pa['name']} boundary" if a.boundary_km < 2.5 else f"in {pa['name']}"
        ev = self._event(
            "ALERT", a, _iso(),
            f"{a.species} activity {trend.lower()} {where}.",
            hotspot=hs,
            detail={"trend": trend, "hotspot_score": round(float(hs.get("risk_score") or score), 1),
                    "boundary_km": round(a.boundary_km, 2), "settlement_km": round(a.settlement_km, 2),
                    "kind": "hotspot" if crossed_hotspot else "animal"},
        )
        ev["risk_score"] = round(score, 1)
        ev["risk_level"] = risk_level_from_score(score)
        return ev

    def _decorate_trends(self, parts: dict):
        seen = set()
        for f in parts["hotspots"]["features"]:
            p = f["properties"]
            hid = p["id"]
            seen.add(hid)
            hist = self._hs_hist.setdefault(hid, deque(maxlen=24))
            hist.append(round(float(p["risk_score"]), 1))
            p["trend"] = list(hist)
            p["trend_dir"] = ("up" if len(hist) > 3 and hist[-1] > hist[-4] + 2
                              else "down" if len(hist) > 3 and hist[-1] < hist[-4] - 2 else "flat")
        for hid in list(self._hs_hist):
            if hid not in seen:
                del self._hs_hist[hid]
                self._hs_level.pop(hid, None)

    # ---------------- read side ----------------
    def _build_animals_fc(self) -> dict:
        feats = []
        for a in self.animals:
            if not a.active:
                continue
            ctx = self.contexts[a.pa_code]
            trail = [[round(h[0], 5), round(h[1], 5)] for h in list(a.history)[-SNAPSHOT_TRAIL_POINTS:]]
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(a.lng, 5), round(a.lat, 5)]},
                "properties": {
                    "animal_id": a.id, "species": a.species,
                    "species_code": SPECIES_PROFILES[a.species]["code"],
                    "risk_score": a.risk_score, "risk_level": a.risk_level,
                    "heading": round(a.heading, 1), "compass": compass(a.heading), "speed": a.speed,
                    "confidence": round(a.confidence, 1), "state": a.state,
                    "protected_area": ctx.name, "protected_area_code": ctx.code,
                    "timestamp": a.updated_at, "last_seen": a.last_seen,
                    "boundary_km": round(a.boundary_km, 2), "settlement_km": round(a.settlement_km, 2),
                    "detections": a.detections, "trail": trail,
                    "risk_history": list(a.risk_history), "simulated": True,
                },
            })
        return _fc(feats)

    def _mode(self) -> str:
        if self.store is not None:
            return self.store.mode
        return "postgis" if self.db_ok else "memory"

    def _status_locked(self) -> dict:
        now = time.time()
        recent15 = sum(1 for t in self._det_times if now - t <= 15)
        recent60 = sum(1 for t in self._det_times if now - t <= 60)
        zones = self._parts.get("zones", {})
        hs = self._parts["hotspots"]["features"]
        active = [a for a in self.animals if a.active]
        hh, mm = divmod(int(self.clock_min) % (24 * 60), 60)
        return {
            "label": "SIMULATION DATA",
            "running": self._run.is_set(), "speed": self.speed, "tick": self.tick,
            "interval_s": round(BASE_INTERVAL_S / self.speed, 2),
            "sim_clock": f"{hh:02d}:{mm:02d}",
            "mode": self._mode(), "db_available": self.db_ok, "db_error": self.db_error,
            "risk_source": self.risk_source,
            "animals_total": len(self.animals), "animals_active": len(active),
            "high_risk_animals": sum(1 for a in active if a.risk_level == "HIGH"),
            "events_total": self._events_total,
            "events_per_sec": round(recent15 / 15.0, 2),
            "detections_per_min": recent60,
            "hotspots_active": len(hs),
            "high_risk_hotspots": sum(1 for f in hs if f["properties"]["risk_level"] == "HIGH"),
            "high_risk_zones": sum(1 for z in zones.values() if z["risk_level"] == "HIGH"),
            "last_detection": self._last_detection,
            "started_at": self.started_at, "server_time": _iso(),
        }

    def status(self) -> dict:
        with self._lock:
            return self._status_locked()

    def snapshot(self, include_geometry: bool = False) -> dict:
        with self._lock:
            snap = {
                "version": self.version, "live": self.tick > 0,
                "status": self._status_locked(),
                "animals": self._animals_fc,
                "hotspots": self._parts["hotspots"],
                "detections": self._parts["detections"],
                "zones": self._parts["zones"],
                "events": list(self.events)[:SNAPSHOT_EVENTS],
            }
            if include_geometry:
                snap["geometry"] = self._geometry_fc
            return snap

    def get_events(self, since_seq: int = 0, limit: int = 50) -> List[dict]:
        with self._lock:
            out = [e for e in self.events if e["seq"] > since_seq]
        return out[:limit]

    def tracks_fc(self) -> dict:
        with self._lock:
            feats = []
            for a in self.animals:
                if not a.active or len(a.history) < 2:
                    continue
                feats.append({
                    "type": "Feature",
                    "geometry": {"type": "LineString",
                                 "coordinates": [[round(h[1], 5), round(h[0], 5)] for h in a.history]},
                    "properties": {"animal_id": a.id, "species": a.species, "risk_level": a.risk_level,
                                   "points": len(a.history), "simulated": True},
                })
            return _fc(feats)


_sim: Optional[Simulator] = None
_sim_lock = threading.Lock()


def get_simulator() -> Simulator:
    global _sim
    with _sim_lock:
        if _sim is None:
            _sim = Simulator()
        return _sim
