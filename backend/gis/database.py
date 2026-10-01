"""
PostGIS connection helper for the KAVACH GIS layer.

Configure with the DATABASE_URL env var, e.g.:
    postgresql://kavach:kavach@localhost:5432/kavach_gis

Falls back to that same local default so `docker-compose up` + this
backend work together with zero extra config for the hackathon demo.
"""

import os
import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://kavach:kavach@localhost:5432/kavach_gis",
)


def get_connection():
    """New psycopg2 connection. Caller is responsible for closing it."""
    return psycopg2.connect(DATABASE_URL)


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
