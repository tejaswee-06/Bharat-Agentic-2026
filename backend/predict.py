import logging
import joblib
import pandas as pd
from pydantic import BaseModel
from pathlib import Path
from typing import Optional
import shutil
import uuid

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from fastapi import FastAPI

app = FastAPI()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("kavach")

# --------------------------------------------------
# GIS LAYER (OPTIONAL / SOFT DEPENDENCY)
# --------------------------------------------------
# GIS (PostGIS + FastAPI) — see gis/ package. This is meant to be purely
# additive: it should add /gis/* routes and a location hook onto the
# existing /risk endpoint, but it must NEVER be able to take down the
# core YOLO + ML risk pipeline.
#
# Previously this was a hard `from gis... import ...` at module scope,
# which meant that if psycopg2-binary failed to install/import (a very
# common environment issue — wrong wheel for the OS/Python version, or
# Postgres/PostGIS simply not running), the ENTIRE FastAPI app would
# fail to start, taking /predict and /risk down with it even though
# neither of those endpoints has anything to do with GIS. That is the
# most likely explanation for "YOLO/ML not working" if GIS wasn't set
# up: the app never even booted.
#
# Fix: import GIS defensively. If it's unavailable for any reason, the
# app still starts and /predict + /risk work exactly as before; the
# /gis/* routes just won't exist and a warning is logged.
GIS_ENABLED = True
try:
    from gis.router import router as gis_router
    from gis.spatial import record_detection
except Exception as e:  # noqa: BLE001 - intentionally broad: any GIS
    # import failure must degrade gracefully, never crash the app.
    GIS_ENABLED = False
    gis_router = None
    record_detection = None
    logger.warning(
        "GIS layer disabled (import failed): %s. "
        "Core YOLO/ML pipeline is unaffected.", e
    )


# --------------------------------------------------
# PATHS
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "best.pt"
UPLOAD_DIR = BASE_DIR / "uploads"

UPLOAD_DIR.mkdir(exist_ok=True)


# --------------------------------------------------
# LOAD OUR TRAINED 5-CLASS YOLO MODEL
# --------------------------------------------------

if not MODEL_PATH.exists():
    raise RuntimeError(
        f"YOLO weights not found at {MODEL_PATH}. "
        f"Make sure best.pt is present in the backend/ directory."
    )

try:
    model = YOLO(str(MODEL_PATH))
    logger.info("✅ YOLO model loaded successfully from %s", MODEL_PATH)
    logger.info("   Classes: %s", model.names)
except Exception as e:
    raise RuntimeError(
        f"Failed to load YOLO model from {MODEL_PATH}: {e}. "
        f"Check that 'ultralytics' and its dependencies (torch, opencv) "
        f"are installed correctly (see requirements.txt)."
    ) from e

RISK_MODEL_PATH = BASE_DIR / "risk_model.pkl"

if not RISK_MODEL_PATH.exists():
    raise RuntimeError(
        f"Risk model not found at {RISK_MODEL_PATH}. "
        f"Make sure risk_model.pkl is present in the backend/ directory."
    )

try:
    risk_model = joblib.load(RISK_MODEL_PATH)
    logger.info("✅ Risk ML model loaded successfully!")
except Exception as e:
    raise RuntimeError(
        f"Failed to load risk_model.pkl: {e}. "
        f"This is usually a scikit-learn version mismatch between the "
        f"environment the model was trained in and this environment — "
        f"see requirements.txt for the pinned version."
    ) from e

# Species categories the risk model actually saw during training
# (from ml/generate_dataset.py / ml/risk_dataset.csv). The model's
# OneHotEncoder(handle_unknown="ignore") will silently zero out the
# species signal for anything outside this set instead of erroring —
# so we track it here to surface a warning instead of a silent gap.
try:
    _cat_encoder = risk_model.named_steps["preprocessor"].named_transformers_["cat"]
    KNOWN_RISK_SPECIES = set(_cat_encoder.categories_[0])
except Exception:
    KNOWN_RISK_SPECIES = None


# --------------------------------------------------
# MAP RAW MODEL CLASS NAMES -> FRONTEND SPECIES LABELS
# The frontend (KavachApp.jsx SPECIES_LIST / ZONES) expects these
# exact display names. The underlying trained classes are kept
# untouched in `class_name` for reference.
# --------------------------------------------------

SPECIES_DISPLAY_MAP = {
    "elephant": "Asian Elephant",
    "leopard": "Leopard",
    "wildboar": "Wild Boar",
    "Tiger": "Tiger",
    "Lion": "Lion",  # not present in frontend's zone list, passed through as-is
}


# --------------------------------------------------
# FASTAPI APP
# --------------------------------------------------

app = FastAPI(title="KAVACH Wildlife Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if GIS_ENABLED:
    app.include_router(gis_router)


# --------------------------------------------------
# HEALTH CHECK
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "status": "online",
        "model": "KAVACH Wildlife YOLO",
        "classes": [
            "Lion",
            "Tiger",
            "elephant",
            "leopard",
            "wildboar"
        ]
    }


# --------------------------------------------------
# WILDLIFE DETECTION
# --------------------------------------------------

ALLOWED_CONTENT_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/bmp"
}


@app.post("/predict")
async def predict(file: UploadFile = File(...)):

    # --- Validate the upload before touching YOLO at all ---
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided.")

    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type '{file.content_type}'. "
                f"Upload an image (jpeg/png/webp/bmp)."
            ),
        )

    # Create unique filename
    filename = f"{uuid.uuid4()}_{file.filename}"
    image_path = UPLOAD_DIR / filename

    # Save uploaded image
    try:
        with open(image_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.exception("Failed to save uploaded file")
        raise HTTPException(status_code=500, detail=f"Could not save upload: {e}")

    if image_path.stat().st_size == 0:
        image_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        # Run YOLO
        results = model(
            str(image_path),
            conf=0.25,
            verbose=False
        )

        detections = []

        for result in results:

            boxes = result.boxes

            for box in boxes:

                class_id = int(box.cls[0])
                confidence = float(box.conf[0])
                raw_name = model.names[class_id]

                x1, y1, x2, y2 = box.xyxy[0].tolist()

                detections.append({
                    "species": SPECIES_DISPLAY_MAP.get(raw_name, raw_name),
                    "class_name": raw_name,
                    "confidence": round(confidence * 100, 2),
                    "bbox": [
                        round(x1, 2),
                        round(y1, 2),
                        round(x2, 2),
                        round(y2, 2)
                    ]
                })

        # Sort by confidence, highest first, so the frontend can just take
        # detections[0] as the primary result for its single-result display.
        detections.sort(key=lambda d: d["confidence"], reverse=True)

        return {
            "success": True,
            "count": len(detections),
            "detections": detections
        }

    except HTTPException:
        raise
    except Exception as e:
        # Covers: corrupt/unreadable image, unsupported format PIL/cv2
        # can't decode, etc. Never let a bad image crash the server or
        # return a bare 500 with no explanation.
        logger.exception("YOLO inference failed")
        raise HTTPException(
            status_code=422,
            detail=f"Could not run detection on this image: {e}",
        )
    finally:
        # Remove temporary image regardless of success/failure
        try:
            image_path.unlink(missing_ok=True)
        except Exception:
            pass

class RiskRequest(BaseModel):
    species: str
    yolo_confidence: float
    recent_detections: int
    historical_conflicts: int
    settlement_proximity: int
    temporal_pattern: int
    environmental_context: int
    spatial_relationship: int

    # --- GIS additions (all optional, fully backward compatible) ---
    # zone_code: existing frontend zone id (e.g. "Z-04"). If provided,
    # the real camera location on file for that zone is used.
    # lat/lng: real coordinates, used directly if provided (overrides zone_code).
    zone_code: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


@app.post("/risk")
def predict_risk(data: RiskRequest):

    input_data = pd.DataFrame([{
        "species": data.species,
        "yolo_confidence": data.yolo_confidence,
        "recent_detections": data.recent_detections,
        "historical_conflicts": data.historical_conflicts,
        "settlement_proximity": data.settlement_proximity,
        "temporal_pattern": data.temporal_pattern,
        "environmental_context": data.environmental_context,
        "spatial_relationship": data.spatial_relationship
    }])

    try:
        prediction = risk_model.predict(input_data)[0]
    except Exception as e:
        logger.exception("Risk model prediction failed")
        raise HTTPException(
            status_code=422,
            detail=f"Could not compute risk score for this input: {e}",
        )

    risk_score = float(max(0, min(100, prediction)))

    if risk_score < 40:
        risk_level = "LOW"
    elif risk_score < 70:
        risk_level = "MEDIUM"
    else:
        risk_level = "HIGH"

    response = {
        "success": True,
        "risk_score": round(risk_score, 2),
        "risk_level": risk_level
    }

    # The risk model was trained only on: Asian Elephant, Tiger, Leopard,
    # Wild Boar, Spotted Deer (see ml/generate_dataset.py). Its
    # OneHotEncoder(handle_unknown="ignore") silently zeroes out the
    # species signal for anything else (e.g. YOLO's "Lion" class) rather
    # than erroring — so the prediction still returns, but without any
    # species-specific contribution. Surface that instead of hiding it.
    if KNOWN_RISK_SPECIES is not None and data.species not in KNOWN_RISK_SPECIES:
        response["warning"] = (
            f"Species '{data.species}' was not in the risk model's training "
            f"data ({sorted(KNOWN_RISK_SPECIES)}); risk score was computed "
            f"without a species-specific contribution."
        )

    # GIS hook: only runs if the frontend supplied a zone_code or a real
    # lat/lng. Resolves the real forest/protected area via PostGIS
    # (ST_Contains / ST_DWithin), stores the detection, and refreshes
    # the map hotspot. Never blocks the existing risk response.
    if data.zone_code or (data.lat is not None and data.lng is not None):
        try:
            from gis.database import is_available, get_connection, dict_cursor
            from gis.spatial import resolve_zone_code_to_point

            lat, lng = data.lat, data.lng
            if lat is None or lng is None:
                if is_available():
                    conn = get_connection()
                    try:
                        with dict_cursor(conn) as cur:
                            cam = resolve_zone_code_to_point(cur, data.zone_code)
                    finally:
                        conn.close()
                    if cam:
                        lat, lng = cam["lat"], cam["lng"]

            if lat is not None and lng is not None and is_available():
                gis_result = record_detection(
                    species=data.species,
                    confidence=data.yolo_confidence,
                    risk_score=risk_score,
                    lat=lat,
                    lng=lng,
                    zone_code=data.zone_code,
                )
                response["gis"] = gis_result
        except Exception as e:
            # GIS being down should never break the existing risk pipeline
            response["gis_error"] = str(e)

    return response