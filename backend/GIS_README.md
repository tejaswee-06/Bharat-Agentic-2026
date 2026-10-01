# KAVACH GIS Layer — Setup

Real PostGIS-backed GIS for the "GIS Map" tab. Additive only — the
existing YOLO / risk-model endpoints (`/predict`, `/risk`) are
untouched except for one optional hook that attaches a real location
when the frontend sends a `zone_code` or `lat`/`lng`.

## 1. Start PostGIS

```bash
cd backend
docker compose up -d
```

This starts Postgres+PostGIS on `localhost:5432` (db `kavach_gis`,
user/pass `kavach`/`kavach`) and auto-runs `gis/schema.sql` on first
boot.

If you already have your own Postgres/PostGIS instance, just point
`DATABASE_URL` at it instead (see below) and run:

```bash
psql "$DATABASE_URL" -f gis/schema.sql
```

## 2. Seed real Maharashtra protected-area data

```bash
pip install -r requirements.txt
python -m gis.seed_protected_areas
```

This inserts ~11 real Maharashtra reserves (Tadoba-Andhari, Melghat,
Pench, Sahyadri, Navegaon-Nagzira, Bor, Umred-Karhandla, Koka, Amba
Barwa, Sanjay Gandhi NP, Karnala) using their published centroid
coordinates and official area figures, plus the camera-location bridge
table that maps the existing frontend zone ids (`Z-01`..`Z-07`) to
real points. See `gis/seed_protected_areas.py` for sources and the
note on polygon-outline approximation.

## 3. Run the API (unchanged command)

```bash
uvicorn predict:app --reload --port 8000
```

`GET /gis/protected-areas`, `/gis/zones`, `/gis/hotspots`,
`/gis/detections` are now live at `http://localhost:8000/gis/...` and
`GET /gis/health` reports PostGIS connectivity.

## Config

| Env var        | Default                                                 |
|----------------|----------------------------------------------------------|
| `DATABASE_URL` | `postgresql://kavach:kavach@localhost:5432/kavach_gis`   |

## Demo flow this enables

```
IMAGE -> YOLO (/predict) -> ML RISK (/risk) -> zone_code/lat,lng
      -> PostGIS ST_Contains / ST_DWithin (gis/spatial.py)
      -> real forest/protected area + risk attached
      -> hotspot generated/updated (gis/spatial.py)
      -> GET /gis/hotspots, /gis/protected-areas, /gis/detections
      -> rendered on the React-Leaflet GIS map
```

If PostGIS isn't running, every `/gis/*` endpoint fails soft (returns
an empty `FeatureCollection` with a `warning`) instead of crashing —
the rest of the app (YOLO, risk, alerts) keeps working normally, and
the frontend map falls back to the previous demo zone layout.
