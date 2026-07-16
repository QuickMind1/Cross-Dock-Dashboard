# Cross Dock Dashboard - Backend

FastAPI service that reads trip data from the local MySQL database `CrossDock`
(`localhost:3307`, user `root`, empty password) and serves the static frontend
so everything runs on the same origin (Firebase Auth keeps working).

## Setup

From the repo root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

## Run

```bash
uvicorn backend.main:app --reload --port 8000
```

Then open the dashboard at:

```
http://localhost:8000
```

## Endpoint

- `GET /api/trips` — returns all trips mapped to the keys the frontend expects,
  including a `transportistas` array with every driver linked to each trip.
