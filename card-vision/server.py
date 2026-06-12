"""
HTTP API for the YOLO card detector — used by csv-card-editor (Next.js).

Run from this directory:
  pip install -r requirements.txt
  python -m uvicorn server:app --host 127.0.0.1 --port 8787

Optional env:
  CARD_VISION_MODEL_PATH — path to best.pt (default: ./model-output/weights/best.pt)
  CARD_VISION_IMGSZ — inference square size (default 960; training was often 640; higher can help small cards)
  CARD_VISION_TTA — if "1"/"true", default requests use test-time augmentation (slower, sometimes better)
"""

import base64
import binascii
import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import Optional, Union

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from ultralytics import YOLO

from _config import MODEL_PATH

try:
    _DEFAULT_IMGSZ = int(os.environ.get("CARD_VISION_IMGSZ", "960"))
except ValueError as exc:
    raise ValueError("CARD_VISION_IMGSZ must be a valid integer") from exc
_DEFAULT_TTA = os.environ.get("CARD_VISION_TTA", "").lower() in ("1", "true", "yes")


def _snap_imgsz(n: int) -> int:
    # YOLOv8 requires image dimensions as multiples of its stride (32); 320–2048 are practical bounds.
    # Keep bounds in sync with csv-card-editor/app/api/card-vision/route.ts.
    s = max(320, min(2048, (int(n) // 32) * 32))
    return s

_model: Optional[YOLO] = None
_model_lock = threading.Lock()


def get_model() -> YOLO:
    global _model
    with _model_lock:
        if _model is None:
            if not MODEL_PATH.is_file():
                raise RuntimeError(
                    f"Model weights not found: {MODEL_PATH}. Train or copy best.pt, or set CARD_VISION_MODEL_PATH."
                )
            _model = YOLO(str(MODEL_PATH))
        return _model


@asynccontextmanager
async def _lifespan(_: FastAPI):
    # Warm-load so the first /infer doesn't pay the multi-second model load (which can brush
    # the proxy's 30 s timeout). On failure keep serving: /infer returns the specific error.
    try:
        get_model()
    except Exception:
        logging.exception("Model not loaded at startup; /infer will report the error")
    yield


app = FastAPI(title="Card-Vision API", version="1.0.0", lifespan=_lifespan)


class InferBody(BaseModel):
    imageBase64: str = Field(..., max_length=14_666_000, description="JPEG/PNG as base64 (optional data URL prefix)")
    confidence: float = Field(0.25, ge=0.0, le=1.0)
    imgsz: Optional[int] = Field(
        None,
        ge=320,
        le=2048,
        description="Inference size (multiple of 32). Higher often helps small objects; slower.",
    )
    augment: Optional[bool] = Field(
        None,
        description="Test-time augmentation. If null, uses CARD_VISION_TTA env default.",
    )


@app.get("/health")
def health() -> dict[str, Union[str, int, bool]]:
    return {
        "status": "ok",
        "model_path": MODEL_PATH.name,
        "weights_exist": MODEL_PATH.is_file(),
        "default_imgsz": _snap_imgsz(_DEFAULT_IMGSZ),
        "default_tta": _DEFAULT_TTA,
    }


@app.post("/infer")
def infer(body: InferBody) -> dict:
    raw = body.imageBase64.strip()
    if raw.startswith("data:") and ";base64," in raw:
        raw = raw.split(";base64,", 1)[1]
    try:
        data = base64.b64decode(raw, validate=True)
    except binascii.Error as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64: {exc}") from exc

    if len(data) > 11_000_000:
        raise HTTPException(status_code=413, detail="Image payload too large (max ~11 MB).")
    arr = np.frombuffer(data, dtype=np.uint8)
    im = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if im is None:
        raise HTTPException(status_code=400, detail="Could not decode image bytes as JPEG/PNG.")

    imgsz = _snap_imgsz(body.imgsz if body.imgsz is not None else _DEFAULT_IMGSZ)
    augment = _DEFAULT_TTA if body.augment is None else body.augment

    try:
        model = get_model()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Model load failed: {exc}") from exc

    # Ultralytics YOLO objects are not thread-safe: predict() lazily creates and mutates the
    # shared predictor (warmup, buffers, args), so concurrent calls on one instance can crash
    # or mix results. FastAPI runs this sync endpoint on a threadpool, so serialise inference.
    try:
        with _model_lock:
            results = model.predict(
                source=im,
                conf=body.confidence,
                imgsz=imgsz,
                augment=augment,
                verbose=False,
            )
    except Exception as exc:
        logging.exception("Inference failed")
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc
    if not results:
        raise HTTPException(status_code=500, detail="Inference returned no results.")
    r = results[0]
    h, w = im.shape[:2]

    preds: list[dict] = []
    if r.boxes is not None and len(r.boxes):
        names = r.names
        for b in r.boxes:
            xywh = b.xywh[0].tolist()
            cx, cy, bw, bh = xywh
            cls_id = int(b.cls[0])
            conf = float(b.conf[0])
            label = str(names.get(cls_id, "")) if names else str(cls_id)
            if not label:
                logging.warning("Unknown class_id %d — skipping prediction", cls_id)
                continue
            preds.append(
                {
                    "x": cx,
                    "y": cy,
                    "width": bw,
                    "height": bh,
                    "confidence": conf,
                    "class": label,
                    "class_id": cls_id,
                }
            )

    return {"predictions": preds, "image": {"width": w, "height": h}, "infer": {"imgsz": imgsz, "augment": augment}}
