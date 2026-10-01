"""
Core PostGIS spatial operations for KAVACH.

This is the module that implements the requested flow:

    Existing YOLO detection
      -> Existing ML risk prediction
      -> Get detection/camera location
      -> PostGIS spatial query               (this module)
      -> Find actual forest/protected area + zone
      -> Attach risk score to geographic location
      -> Generate GIS hotspot
      -> Show it on the existing GIS UI
"""

from .database import get_connection, dict_cursor, ensure_simulation_schema

# Detections farther than this from any protected-area boundary are
# still resolved to the NEAREST reserve (ST_DWithin / ST_Distance) so
# a camera just outside a park boundary still lands on the map.
NEAREST_FALLBACK_RADIUS_M = 15000  # 15 km

# A hotspot is refreshed from all detections within this radius of a
# new detection, inside the same protected area.
HOTSPOT_CLUSTER_RADIUS_M = 3000  # 3 km

# Simulated animals cover far more ground per tick than a real animal does
# between two camera captures (movement is time-compressed for the demo), so
# simulated detections cluster over a wider radius. Real detections keep 3 km.
SIM_HOTSPOT_CLUSTER_RADIUS_M = 7000  # 7 km


def risk_level_from_score(score: float) -> str:
    if score < 40:
        return "LOW"
    if score < 70:
        return "MEDIUM"
    return "HIGH"


def resolve_point_to_protected_area(cur, lat: float, lng: float):
    """PostGIS spatial query: find which real protected area a point
    falls inside (ST_Contains), or if it's outside every boundary,
    the nearest one within NEAREST_FALLBACK_RADIUS_M (ST_DWithin +
    ST_Distance, both evaluated on the geography type for accurate
    metres).
    """
    cur.execute(
        """
        SELECT id, code, name, area_type, district, official_area_km2, primary_species,
               TRUE AS contained, 0 AS distance_m
        FROM protected_areas
        WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326))
        LIMIT 1
        """,
        {"lat": lat, "lng": lng},
    )
    row = cur.fetchone()
    if row:
        return row

    cur.execute(
        """
        SELECT id, code, name, area_type, district, official_area_km2, primary_species,
               FALSE AS contained,
               ST_Distance(
                   geom::geography,
                   ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography
               ) AS distance_m
        FROM protected_areas
        WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography,
            %(radius)s
        )
        ORDER BY distance_m ASC
        LIMIT 1
        """,
        {"lat": lat, "lng": lng, "radius": NEAREST_FALLBACK_RADIUS_M},
    )
    return cur.fetchone()


def resolve_zone_code_to_point(cur, zone_code: str):
    """Look up a real lat/lng for an existing frontend zone id
    (Z-01..Z-07), so the existing YOLO/risk pipeline — which only
    ever knows a zone id — can be dropped straight into the spatial
    pipeline without any frontend changes.
    """
    cur.execute(
        "SELECT zone_code, label, ST_Y(geom) AS lat, ST_X(geom) AS lng, protected_area_id "
        "FROM camera_locations WHERE zone_code = %s",
        (zone_code,),
    )
    return cur.fetchone()


def record_detection(species: str, confidence: float, risk_score: float,
                      lat: float, lng: float, zone_code: str = None,
                      source: str = "real"):
    """Full pipeline step: resolve location -> real protected area,
    insert the detection, regenerate the hotspot for that cluster.
    Returns a dict describing what was resolved/created.

    `source` is "real" for the YOLO/risk pipeline (the default, so every
    existing caller behaves exactly as before) or "simulation" for the
    simulator. Both feed the SAME detections/hotspots tables and the same
    hotspot-clustering logic; the tag only keeps them distinguishable.
    """
    has_source_col = ensure_simulation_schema()
    conn = get_connection()
    try:
        with dict_cursor(conn) as cur:
            pa = resolve_point_to_protected_area(cur, lat, lng)
            risk_level = risk_level_from_score(risk_score)
            pa_id = pa["id"] if pa else None

            if has_source_col:
                cur.execute(
                    """
                    INSERT INTO detections
                        (zone_code, species, confidence, risk_score, risk_level, protected_area_id, geom, source)
                    VALUES (%s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s)
                    RETURNING id, detected_at
                    """,
                    (zone_code, species, confidence, risk_score, risk_level, pa_id, lng, lat, source),
                )
            else:  # schema upgrade not possible -> original statement, unchanged
                cur.execute(
                    """
                    INSERT INTO detections
                        (zone_code, species, confidence, risk_score, risk_level, protected_area_id, geom)
                    VALUES (%s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                    RETURNING id, detected_at
                    """,
                    (zone_code, species, confidence, risk_score, risk_level, pa_id, lng, lat),
                )
            detection_row = cur.fetchone()

            hotspot = _generate_hotspot(cur, pa_id, lat, lng, risk_score, risk_level, species,
                                        source=source if has_source_col else "real",
                                        has_source_col=has_source_col)
            conn.commit()

            return {
                "detection_id": detection_row["id"],
                "detected_at": detection_row["detected_at"].isoformat(),
                "protected_area": dict(pa) if pa else None,
                "hotspot": hotspot,
            }
    finally:
        conn.close()


# --- simulation hotspot dynamics (shared by the in-memory store) -------
# Real hotspots keep the original "max risk ever seen" behaviour. Simulated
# hotspots must move both ways, so they blend the new detection into the
# running score, add a bonus that grows as detections cluster, and are
# decayed by the simulator when a cluster goes quiet.
def sim_blend_score(existing_score: float, new_risk: float, new_count: int) -> float:
    bonus = min(3.0, 0.3 * (new_count - 1))
    return max(0.0, min(100.0, 0.6 * existing_score + 0.4 * new_risk + bonus))


def sim_radius_m(risk_score: float) -> int:
    return int(1200 + 22 * risk_score)


def _generate_hotspot(cur, protected_area_id, lat, lng, risk_score, risk_level, species,
                      source="real", has_source_col=False):
    """ST_DWithin-based clustering: if a recent detection already
    exists within HOTSPOT_CLUSTER_RADIUS_M in the same protected
    area, fold this detection into it (recompute a risk-weighted
    centroid + take the max risk score). Otherwise create a new
    hotspot. This is what drives the risk-zone bubbles on the map.

    With source="simulation" the cluster is looked up among simulated
    hotspots only and the score follows sim_blend_score() so it can rise
    AND fall. source="real" is the original behaviour, unchanged.
    """
    src_filter = "AND source = %(source)s" if has_source_col else ""
    cluster_radius = SIM_HOTSPOT_CLUSTER_RADIUS_M if source == "simulation" else HOTSPOT_CLUSTER_RADIUS_M
    cur.execute(
        f"""
        SELECT id, risk_score, detection_count,
               ST_Y(geom) AS lat, ST_X(geom) AS lng
        FROM hotspots
        WHERE protected_area_id = %(pa_id)s
          {src_filter}
          AND ST_DWithin(
              geom::geography,
              ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography,
              %(radius)s
          )
        ORDER BY ST_Distance(
            geom::geography,
            ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography
        ) ASC
        LIMIT 1
        """,
        {"pa_id": protected_area_id, "lat": lat, "lng": lng,
         "radius": cluster_radius, "source": source},
    )
    existing = cur.fetchone()
    simulated = source == "simulation"

    if existing:
        n = existing["detection_count"] + 1
        new_lat = (existing["lat"] * existing["detection_count"] + lat) / n
        new_lng = (existing["lng"] * existing["detection_count"] + lng) / n
        if simulated:
            new_score = sim_blend_score(float(existing["risk_score"]), risk_score, n)
            radius = sim_radius_m(new_score)
        else:
            new_score = max(float(existing["risk_score"]), risk_score)
            radius = None
        if radius is not None:
            cur.execute(
                """
                UPDATE hotspots
                SET risk_score = %s, risk_level = %s, species = %s,
                    detection_count = %s, radius_m = %s,
                    geom = ST_SetSRID(ST_MakePoint(%s, %s), 4326), updated_at = now()
                WHERE id = %s
                RETURNING id, risk_score, risk_level, detection_count, radius_m
                """,
                (new_score, risk_level_from_score(new_score), species, n, radius,
                 new_lng, new_lat, existing["id"]),
            )
        else:
            cur.execute(
                """
                UPDATE hotspots
                SET risk_score = %s, risk_level = %s, species = %s,
                    detection_count = %s, geom = ST_SetSRID(ST_MakePoint(%s, %s), 4326),
                    updated_at = now()
                WHERE id = %s
                RETURNING id, risk_score, risk_level, detection_count, radius_m
                """,
                (new_score, risk_level_from_score(new_score), species, n, new_lng, new_lat, existing["id"]),
            )
    else:
        if has_source_col:
            cur.execute(
                """
                INSERT INTO hotspots
                    (protected_area_id, risk_score, risk_level, species, detection_count, radius_m, geom, source)
                VALUES (%s, %s, %s, %s, 1, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s)
                RETURNING id, risk_score, risk_level, detection_count, radius_m
                """,
                (protected_area_id, risk_score, risk_level, species,
                 sim_radius_m(risk_score) if simulated else 1500, lng, lat, source),
            )
        else:
            cur.execute(
                """
                INSERT INTO hotspots
                    (protected_area_id, risk_score, risk_level, species, detection_count, radius_m, geom)
                VALUES (%s, %s, %s, %s, 1, 1500, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                RETURNING id, risk_score, risk_level, detection_count, radius_m
                """,
                (protected_area_id, risk_score, risk_level, species, lng, lat),
            )
    return dict(cur.fetchone())
