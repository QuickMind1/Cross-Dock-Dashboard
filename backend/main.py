"""FastAPI backend that serves the Cross Dock dashboard and exposes trip data from MySQL.

Data source migrated from Firestore to a local MySQL database. The frontend
(dashboard_map.js) expects Spanish-keyed trip objects, so the /api/trips endpoint
maps the MySQL columns to those keys to keep the UI unchanged.
"""

from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path

import mysql.connector
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

DB_CONFIG = {
    "host": "localhost",
    "port": 3307,
    "user": "root",
    "password": "",
    "database": "CrossDock",
}

# Repo root (one level up from this backend/ folder) holds the static frontend.
FRONTEND_DIR = Path(__file__).resolve().parent.parent

app = FastAPI(title="Cross Dock Dashboard API")


def get_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as exc:
        raise HTTPException(status_code=503, detail=f"MySQL connection error: {exc}") from exc


def _serialize(value):
    """Convert non-JSON-native MySQL values into serializable forms."""
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace")
    return value


@app.get("/api/trips")
def get_trips():
    conn = get_connection()
    try:
        cursor = conn.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                t.message_id,
                t.group_id,
                t.message_content,
                t.origin,
                t.destination,
                t.n_drivers_needed,
                t.departure_datetime,
                t.eta_datetime,
                t.cargo_type,
                t.state,
                g.name AS group_name
            FROM trips t
            LEFT JOIN wa_groups g ON t.group_id = g.group_id
            """
        )
        trip_rows = cursor.fetchall()

        cursor.execute(
            """
            SELECT
                td.trip_id,
                d.driver_id,
                d.nickname,
                td.driver_confirmation_message
            FROM trips_drivers td
            JOIN drivers d ON td.driver_id = d.driver_id
            """
        )
        driver_rows = cursor.fetchall()

        cursor.execute(
            """
            SELECT
                trip_id,
                status_type,
                description,
                changed_timestamp
            FROM trip_status_history
            ORDER BY changed_timestamp ASC
            """
        )
        history_rows = cursor.fetchall()
    except mysql.connector.Error as exc:
        raise HTTPException(status_code=500, detail=f"MySQL query error: {exc}") from exc
    finally:
        conn.close()

    drivers_by_trip = {}
    for row in driver_rows:
        drivers_by_trip.setdefault(row["trip_id"], []).append(
            {
                "nickname": _serialize(row["nickname"]),
                "driver_confirmation_message": _serialize(row["driver_confirmation_message"]),
            }
        )

    history_by_trip = {}
    for row in history_rows:
        history_by_trip.setdefault(row["trip_id"], []).append(
            {
                "status_type": _serialize(row["status_type"]),
                "description": _serialize(row["description"]),
                "changed_timestamp": _serialize(row["changed_timestamp"]),
            }
        )

    trips = []
    for row in trip_rows:
        linked_drivers = drivers_by_trip.get(row["message_id"], [])
        trips.append(
            {
                "message_id": _serialize(row["message_id"]),
                "estado": _serialize(row["state"]),
                "origen": _serialize(row["origin"]),
                "destino": _serialize(row["destination"]),
                "fecha_salida": _serialize(row["departure_datetime"]),
                "tipo_carga": _serialize(row["cargo_type"]),
                "cantidadTransportistas": _serialize(row["n_drivers_needed"]),
                "cantidadActualDeTransportistas": len(linked_drivers),
                "transportistas": linked_drivers,
                "grupo": _serialize(row["group_name"]),
                "eta": _serialize(row["eta_datetime"]),
                "mensaje": _serialize(row["message_content"]),
                "historial": history_by_trip.get(row["message_id"], []),
            }
        )

    return JSONResponse(content=trips)


# Serve the static frontend from the repo root so everything is same-origin
# (index.html, dashboard.html, dashboard_map.js, auth.js, image_sources/...).
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
