-- ============================================================
-- KAVACH GIS LAYER — PostgreSQL + PostGIS schema
-- Run once against a fresh database:
--   psql -U kavach -d kavach_gis -f schema.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ------------------------------------------------------------
-- protected_areas
-- Real Maharashtra forest / protected-area boundaries.
-- Geometry is stored as a POLYGON in EPSG:4326 (WGS-84 lat/lng),
-- the same CRS used by Leaflet/GeoJSON, so no reprojection is
-- needed anywhere in the stack.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS protected_areas (
    id               SERIAL PRIMARY KEY,
    code             VARCHAR(20) UNIQUE NOT NULL,      -- e.g. 'PA-TATR'
    name             VARCHAR(150) NOT NULL,
    area_type        VARCHAR(40)  NOT NULL,             -- Tiger Reserve / National Park / Wildlife Sanctuary
    state            VARCHAR(50)  NOT NULL DEFAULT 'Maharashtra',
    district         VARCHAR(80),
    official_area_km2 NUMERIC(10,2),
    primary_species  VARCHAR(120),
    geom             GEOMETRY(POLYGON, 4326) NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_protected_areas_geom ON protected_areas USING GIST (geom);

-- ------------------------------------------------------------
-- camera_locations
-- Physical trail-camera / detection sensor locations. This is
-- the bridge between the existing YOLO pipeline (which only
-- knows a camera/zone id) and real-world coordinates.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS camera_locations (
    id          SERIAL PRIMARY KEY,
    zone_code   VARCHAR(20) UNIQUE NOT NULL,            -- matches existing frontend ZONES[].id e.g. 'Z-04'
    label       VARCHAR(150) NOT NULL,
    geom        GEOMETRY(POINT, 4326) NOT NULL,
    protected_area_id INTEGER REFERENCES protected_areas(id)
);

CREATE INDEX IF NOT EXISTS idx_camera_locations_geom ON camera_locations USING GIST (geom);

-- ------------------------------------------------------------
-- detections
-- One row per YOLO detection that has been resolved to a real
-- location. Populated by predict.py after a /predict + /risk
-- call, via the GIS layer's ST_Contains / ST_DWithin lookup.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS detections (
    id                 SERIAL PRIMARY KEY,
    zone_code          VARCHAR(20),
    species            VARCHAR(80) NOT NULL,
    confidence         NUMERIC(5,2) NOT NULL,
    risk_score         NUMERIC(5,2),
    risk_level         VARCHAR(10),                     -- LOW / MEDIUM / HIGH
    protected_area_id  INTEGER REFERENCES protected_areas(id),
    geom               GEOMETRY(POINT, 4326) NOT NULL,
    detected_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_detections_geom ON detections USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_detections_detected_at ON detections (detected_at DESC);

-- ------------------------------------------------------------
-- hotspots
-- ML-risk-weighted spatial clusters, regenerated every time a
-- new detection is resolved. A hotspot is a buffered circle
-- (ST_Buffer) around the highest-risk recent detections in a
-- protected area, used to drive the "risk zones" layer on the
-- GIS map (independent of the demo ZONES array).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hotspots (
    id                 SERIAL PRIMARY KEY,
    protected_area_id  INTEGER REFERENCES protected_areas(id),
    risk_score         NUMERIC(5,2) NOT NULL,
    risk_level         VARCHAR(10) NOT NULL,
    species            VARCHAR(80),
    detection_count    INTEGER NOT NULL DEFAULT 1,
    radius_m           INTEGER NOT NULL DEFAULT 1500,
    geom               GEOMETRY(POINT, 4326) NOT NULL,   -- centroid; radius_m defines the on-map buffer
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hotspots_geom ON hotspots USING GIST (geom);
