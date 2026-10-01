"""
Seed real Maharashtra forest / protected-area data into PostGIS.

Source of truth for every coordinate, district and official area figure
below is public record (Wikipedia / Maharashtra Forest Department /
NTCA "MEE-TR" tiger-reserve portal) — see the `source` field on each
entry. We do NOT have access to the official NTCA/WII WDPA shapefiles
in this environment, so instead of inventing an arbitrary shape we:

  1. Use the REAL, published centroid (lat/lng) of each reserve.
  2. Use the REAL, published official area (km²) of each reserve.
  3. Generate an irregular (non-circular) polygon around the centroid
     whose area matches the official figure, using a seeded random
     radial perturbation so it reads as a natural boundary instead of
     a perfect circle.

This keeps every number on the map traceable to a public source while
being explicit that the exact polygon outline is an approximation.
Swap `polygon_from_centroid()` for a real WDPA/Bhuvan shapefile import
whenever one is available — the DB schema and every downstream query
(ST_Contains / ST_DWithin / ST_Distance) is unaffected either way.

Run:
    python -m gis.seed_protected_areas
"""

import math
import random

from .database import get_connection

# --------------------------------------------------------------------
# REAL MAHARASHTRA PROTECTED AREAS
# lat/lng = published centroid, area_km2 = published official area
# --------------------------------------------------------------------
PROTECTED_AREAS = [
    dict(code="PA-TATR", name="Tadoba-Andhari Tiger Reserve", area_type="Tiger Reserve",
         district="Chandrapur", lat=20.26667, lng=79.40000, area_km2=1727.59,
         primary_species="Tiger", source="Wikipedia: Tadoba Andhari Tiger Reserve"),
    dict(code="PA-MELG", name="Melghat Tiger Reserve", area_type="Tiger Reserve",
         district="Amravati", lat=21.44583, lng=77.19722, area_km2=2768.00,
         primary_species="Tiger", source="Wikipedia: Melghat"),
    dict(code="PA-PENC", name="Pench Tiger Reserve (Maharashtra)", area_type="Tiger Reserve",
         district="Nagpur", lat=21.69306, lng=79.24833, area_km2=741.20,
         primary_species="Tiger", source="Wikipedia: Pench Tiger Reserve"),
    dict(code="PA-SAHY", name="Sahyadri Tiger Reserve", area_type="Tiger Reserve",
         district="Satara / Sangli / Ratnagiri", lat=17.48611, lng=73.80917, area_km2=1166.00,
         primary_species="Tiger", source="Wikipedia: Sahyadri Tiger Reserve"),
    dict(code="PA-NNTR", name="Navegaon-Nagzira Tiger Reserve", area_type="Tiger Reserve",
         district="Gondia / Bhandara", lat=21.24000, lng=80.02000, area_km2=1894.90,
         primary_species="Tiger", source="MEE-TR Portal: Nawegaon Nagzira Tiger Reserve"),
    dict(code="PA-BOR", name="Bor Tiger Reserve", area_type="Tiger Reserve",
         district="Wardha", lat=20.97750, lng=78.67583, area_km2=138.12,
         primary_species="Tiger", source="Wikipedia: Bor Wildlife Sanctuary"),
    dict(code="PA-UMKA", name="Umred-Karhandla Wildlife Sanctuary", area_type="Wildlife Sanctuary",
         district="Nagpur / Bhandara", lat=20.83556, lng=79.51111, area_km2=189.00,
         primary_species="Tiger", source="Wikipedia: Umred Pauni Karhandla Wildlife Sanctuary"),
    dict(code="PA-KOKA", name="Koka Wildlife Sanctuary", area_type="Wildlife Sanctuary",
         district="Bhandara", lat=21.20686, lng=79.80633, area_km2=92.34,
         primary_species="Leopard", source="Wikipedia: Koka Wildlife Sanctuary"),
    dict(code="PA-AMBA", name="Amba Barwa Wildlife Sanctuary", area_type="Wildlife Sanctuary",
         district="Buldhana", lat=21.22231, lng=76.64867, area_km2=127.11,
         primary_species="Leopard", source="Wikipedia: Amba Barwa Wildlife Sanctuary"),
    dict(code="PA-SGNP", name="Sanjay Gandhi National Park", area_type="National Park",
         district="Mumbai Suburban / Thane", lat=19.25000, lng=72.91700, area_km2=103.84,
         primary_species="Leopard", source="Wikipedia: Sanjay Gandhi National Park"),
    dict(code="PA-KARN", name="Karnala Bird Sanctuary", area_type="Wildlife Sanctuary",
         district="Raigad", lat=18.90861, lng=73.10250, area_km2=12.11,
         primary_species="Spotted Deer", source="Wikipedia: Karnala Bird Sanctuary"),
]

# camera_locations: bridges the existing frontend zone ids (Z-01..Z-07)
# to real points inside/near a real protected area, so the existing
# YOLO/risk pipeline (which only ever produces a zone id) can be
# resolved to a real forest via a PostGIS spatial query.
CAMERA_LOCATIONS = [
    dict(zone_code="Z-01", label="Northern Ridge Trail Cam", lat=21.28, lng=80.00, pa_code="PA-NNTR"),
    dict(zone_code="Z-02", label="River Bend Trail Cam", lat=20.90, lng=78.66, pa_code="PA-BOR"),
    dict(zone_code="Z-03", label="Forest Edge Trail Cam", lat=19.24, lng=72.90, pa_code="PA-SGNP"),
    dict(zone_code="Z-04", label="Settlement Corridor Trail Cam", lat=20.30, lng=79.42, pa_code="PA-TATR"),
    dict(zone_code="Z-05", label="Hillside Trail Cam", lat=18.91, lng=73.11, pa_code="PA-KARN"),
    dict(zone_code="Z-06", label="Buffer Zone South Trail Cam", lat=20.24, lng=79.38, pa_code="PA-TATR"),
    dict(zone_code="Z-07", label="Valley Watch Trail Cam", lat=21.46, lng=77.21, pa_code="PA-MELG"),
]


def polygon_from_centroid(lat, lng, area_km2, code, points=14):
    """Generate a natural-looking (non-circular) closed polygon ring
    around (lat, lng) whose area approximates area_km2.

    A fixed seed per protected-area code keeps the shape stable across
    reseed runs so hotspot/detection demo data lines up consistently.
    """
    rng = random.Random(code)
    equiv_radius_km = math.sqrt(area_km2 / math.pi)

    km_per_deg_lat = 111.32
    km_per_deg_lng = 111.32 * math.cos(math.radians(lat))

    ring = []
    for i in range(points):
        angle = (2 * math.pi * i) / points
        # perturb the radius +-35% so the outline isn't a perfect circle
        r_km = equiv_radius_km * rng.uniform(0.65, 1.35)
        d_lat = (r_km * math.sin(angle)) / km_per_deg_lat
        d_lng = (r_km * math.cos(angle)) / km_per_deg_lng
        ring.append((lng + d_lng, lat + d_lat))
    ring.append(ring[0])  # close the ring

    wkt_points = ", ".join(f"{x} {y}" for x, y in ring)
    return f"POLYGON(({wkt_points}))"


def seed():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            code_to_id = {}
            for pa in PROTECTED_AREAS:
                polygon_wkt = polygon_from_centroid(pa["lat"], pa["lng"], pa["area_km2"], pa["code"])
                cur.execute(
                    """
                    INSERT INTO protected_areas
                        (code, name, area_type, district, official_area_km2, primary_species, geom)
                    VALUES (%s, %s, %s, %s, %s, %s, ST_GeomFromText(%s, 4326))
                    ON CONFLICT (code) DO UPDATE SET
                        name = EXCLUDED.name,
                        area_type = EXCLUDED.area_type,
                        district = EXCLUDED.district,
                        official_area_km2 = EXCLUDED.official_area_km2,
                        primary_species = EXCLUDED.primary_species,
                        geom = EXCLUDED.geom
                    RETURNING id
                    """,
                    (pa["code"], pa["name"], pa["area_type"], pa["district"],
                     pa["area_km2"], pa["primary_species"], polygon_wkt),
                )
                code_to_id[pa["code"]] = cur.fetchone()[0]

            for cam in CAMERA_LOCATIONS:
                pa_id = code_to_id.get(cam["pa_code"])
                point_wkt = f"POINT({cam['lng']} {cam['lat']})"
                cur.execute(
                    """
                    INSERT INTO camera_locations (zone_code, label, geom, protected_area_id)
                    VALUES (%s, %s, ST_GeomFromText(%s, 4326), %s)
                    ON CONFLICT (zone_code) DO UPDATE SET
                        label = EXCLUDED.label,
                        geom = EXCLUDED.geom,
                        protected_area_id = EXCLUDED.protected_area_id
                    """,
                    (cam["zone_code"], cam["label"], point_wkt, pa_id),
                )
        conn.commit()
        print(f"✅ Seeded {len(PROTECTED_AREAS)} protected areas and {len(CAMERA_LOCATIONS)} camera locations.")
    finally:
        conn.close()


if __name__ == "__main__":
    seed()
