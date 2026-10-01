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

-- ============================================================
-- ==== SIMULATION EXTENSION (additive — nothing above is changed)
-- Everything below is idempotent. gis/database.py:ensure_simulation_schema()
-- executes this section automatically, so an existing PostGIS volume that
-- was created before the simulator existed is upgraded in place.
-- ============================================================

-- Tag every detection / hotspot with where it came from so real YOLO data
-- and simulated data can coexist in the SAME tables and layers.
ALTER TABLE detections ADD COLUMN IF NOT EXISTS source VARCHAR(12) NOT NULL DEFAULT 'real';
ALTER TABLE hotspots   ADD COLUMN IF NOT EXISTS source VARCHAR(12) NOT NULL DEFAULT 'real';
CREATE INDEX IF NOT EXISTS idx_detections_source ON detections (source, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_hotspots_source   ON hotspots (source);

-- Current state of every simulated animal (one row per animal).
CREATE TABLE IF NOT EXISTS simulation_animals (
    id                VARCHAR(40) PRIMARY KEY,           -- e.g. 'SIM-TIGER-001'
    species           VARCHAR(80) NOT NULL,
    lat               DOUBLE PRECISION NOT NULL,
    lng               DOUBLE PRECISION NOT NULL,
    previous_lat      DOUBLE PRECISION,
    previous_lng      DOUBLE PRECISION,
    heading           NUMERIC(6,2) NOT NULL DEFAULT 0,   -- degrees, 0 = north, clockwise
    speed             NUMERIC(6,2) NOT NULL DEFAULT 0,   -- km/h
    confidence        NUMERIC(5,2),
    risk_score        NUMERIC(5,2),
    risk_level        VARCHAR(10),
    state             VARCHAR(20),
    protected_area_id INTEGER REFERENCES protected_areas(id),
    active            BOOLEAN NOT NULL DEFAULT TRUE,
    geom              GEOMETRY(POINT, 4326),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sim_animals_geom ON simulation_animals USING GIST (geom);

-- Bounded movement history (the simulator keeps the newest ~60 per animal).
CREATE TABLE IF NOT EXISTS simulation_tracks (
    id          BIGSERIAL PRIMARY KEY,
    animal_id   VARCHAR(40) NOT NULL REFERENCES simulation_animals(id) ON DELETE CASCADE,
    lat         DOUBLE PRECISION NOT NULL,
    lng         DOUBLE PRECISION NOT NULL,
    risk_score  NUMERIC(5,2),
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sim_tracks_animal_ts ON simulation_tracks (animal_id, "timestamp" DESC);

-- Feed of simulated events: DETECTION / BOUNDARY / ALERT.
CREATE TABLE IF NOT EXISTS simulation_events (
    id          BIGSERIAL PRIMARY KEY,
    animal_id   VARCHAR(40),
    event_type  VARCHAR(20) NOT NULL,
    species     VARCHAR(80),
    lat         DOUBLE PRECISION,
    lng         DOUBLE PRECISION,
    risk_score  NUMERIC(5,2),
    risk_level  VARCHAR(10),
    message     TEXT,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sim_events_ts ON simulation_events ("timestamp" DESC);
