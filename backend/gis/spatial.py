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

from .database import get_connection, dict_cursor

# Detections farther than this from any protected-area boundary are
# still resolved to the NEAREST reserve (ST_DWithin / ST_Distance) so
# a camera just outside a park boundary still lands on the map.
NEAREST_FALLBACK_RADIUS_M = 15000  # 15 km

# A hotspot is refreshed from all detections within this radius of a
# new detection, inside the same protected area.
HOTSPOT_CLUSTER_RADIUS_M = 3000  # 3 km


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
                      lat: float, lng: float, zone_code: str = None):
    """Full pipeline step: resolve location -> real protected area,
    insert the detection, regenerate the hotspot for that cluster.
    Returns a dict describing what was resolved/created.
    """
    conn = get_connection()
    try:
        with dict_cursor(conn) as cur:
            pa = resolve_point_to_protected_area(cur, lat, lng)
            risk_level = risk_level_from_score(risk_score)
            pa_id = pa["id"] if pa else None

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

            hotspot = _generate_hotspot(cur, pa_id, lat, lng, risk_score, risk_level, species)
            conn.commit()

            return {
                "detection_id": detection_row["id"],
                "detected_at": detection_row["detected_at"].isoformat(),
                "protected_area": dict(pa) if pa else None,
                "hotspot": hotspot,
            }
    finally:
        conn.close()


def _generate_hotspot(cur, protected_area_id, lat, lng, risk_score, risk_level, species):
    """ST_DWithin-based clustering: if a recent detection already
    exists within HOTSPOT_CLUSTER_RADIUS_M in the same protected
    area, fold this detection into it (recompute a risk-weighted
    centroid + take the max risk score). Otherwise create a new
    hotspot. This is what drives the risk-zone bubbles on the map.
    """
    cur.execute(
        """
        SELECT id, risk_score, detection_count,
               ST_Y(geom) AS lat, ST_X(geom) AS lng
        FROM hotspots
        WHERE protected_area_id = %(pa_id)s
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
        {"pa_id": protected_area_id, "lat": lat, "lng": lng, "radius": HOTSPOT_CLUSTER_RADIUS_M},
    )
    existing = cur.fetchone()

    if existing:
        n = existing["detection_count"] + 1
        new_lat = (existing["lat"] * existing["detection_count"] + lat) / n
        new_lng = (existing["lng"] * existing["detection_count"] + lng) / n
        new_score = max(float(existing["risk_score"]), risk_score)
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
