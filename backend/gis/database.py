"""
PostGIS connection helper for the KAVACH GIS layer.

Configure with the DATABASE_URL env var, e.g.:
    postgresql://kavach:kavach@localhost:5432/kavach_gis

Falls back to that same local default so `docker-compose up` + this
backend work together with zero extra config for the hackathon demo.
"""

import os
import threading
from pathlib import Path

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://kavach:kavach@localhost:5432/kavach_gis",
)


# A short connect timeout keeps every /gis endpoint (and the simulator's tick
# loop) responsive when Postgres is down or the host is unreachable, instead of
# hanging on the OS-level TCP timeout.
CONNECT_TIMEOUT_S = int(os.environ.get("KAVACH_DB_CONNECT_TIMEOUT", "3"))


def get_connection():
    """New psycopg2 connection. Caller is responsible for closing it."""
    return psycopg2.connect(DATABASE_URL, connect_timeout=CONNECT_TIMEOUT_S)


def dict_cursor(conn):
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


def is_available():
    """Cheap health check used by the /gis endpoints to fail soft
    (empty GeoJSON + a warning) instead of crashing the whole API
    when Postgres/PostGIS isn't running — important for a live demo.
    """
    try:
        conn = get_connection()
        conn.close()
        return True
    except Exception:
        return False


# --------------------------------------------------------------------
# Simulation schema upgrade
# --------------------------------------------------------------------
# schema.sql is the single source of truth. Its "SIMULATION EXTENSION"
# section is idempotent (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT
# EXISTS), so we simply execute that tail. This upgrades a PostGIS volume
# that was initialised before the simulator existed without touching or
# renaming any existing table.
_SCHEMA_MARKER = "-- ==== SIMULATION EXTENSION"
_schema_lock = threading.Lock()
_schema_ready = False


def ensure_simulation_schema() -> bool:
    """Idempotently apply the simulation extension. Cached after success;
    returns False (and retries next call) if the DB is unreachable."""
    global _schema_ready
    if _schema_ready:
        return True
    with _schema_lock:
        if _schema_ready:
            return True
        try:
            sql = (Path(__file__).with_name("schema.sql")).read_text(encoding="utf-8")
            tail = sql[sql.index(_SCHEMA_MARKER):]
            conn = get_connection()
            try:
                with conn.cursor() as cur:
                    cur.execute(tail)
                conn.commit()
            finally:
                conn.close()
            _schema_ready = True
        except Exception:  # noqa: BLE001 - never let a schema upgrade crash the API
            return False
    return True
