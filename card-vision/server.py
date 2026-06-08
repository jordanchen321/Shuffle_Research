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

from __future__ import annotations

import base64
import binascii
import os
from pathlib import Path
from typing import Optional, Union

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
DEFAULT_WEIGHTS = ROOT / "model-output" / "weights" / "best.pt"
MODEL_PATH = Path(os.environ.get("CARD_VISION_MODEL_PATH", str(DEFAULT_WEIGHTS)))

_DEFAULT_IMGSZ = int(os.environ.get("CARD_VISION_IMGSZ", "960"))
_DEFAULT_TTA = os.environ.get("CARD_VISION_TTA", "").lower() in ("1", "true", "yes")


def _snap_imgsz(n: int) -> int:
    # YOLOv8 requires image dimensions as multiples of its stride (32); 320–2048 are practical bounds.
    s = max(320, min(2048, (int(n) // 32) * 32))
    return s

app = FastAPI(title="Card-Vision API", version="1.0.0")
_model: Optional[YOLO] = None


def get_model() -> YOLO:
    global _model
    if _model is None:
        if not MODEL_PATH.is_file():
            raise HTTPException(
                status_code=500,
                detail=f"Model weights not found: {MODEL_PATH}. Train or copy best.pt, or set CARD_VISION_MODEL_PATH.",
            )
        _model = YOLO(str(MODEL_PATH))
    return _model


class InferBody(BaseModel):
    imageBase64: str = Field(..., max_length=5_000_000, description="JPEG/PNG as base64 (optional data URL prefix)")
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
        "model_path": str(MODEL_PATH),
        "weights_exist": MODEL_PATH.is_file(),
        "default_imgsz": _snap_imgsz(_DEFAULT_IMGSZ),
        "default_tta": _DEFAULT_TTA,
    }


@app.post("/infer")
def infer(body: InferBody) -> dict:
    raw = body.imageBase64.strip()
    if "base64," in raw:
        raw = raw.split("base64,", 1)[1]
    try:
        data = base64.b64decode(raw)
    except binascii.Error as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64: {exc}") from exc

    arr = np.frombuffer(data, dtype=np.uint8)
    im = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if im is None:
        raise HTTPException(status_code=400, detail="Could not decode image bytes as JPEG/PNG.")

    imgsz = _snap_imgsz(body.imgsz if body.imgsz is not None else _DEFAULT_IMGSZ)
    augment = _DEFAULT_TTA if body.augment is None else body.augment

    model = get_model()
    try:
        results = model.predict(
            source=im,
            conf=body.confidence,
            imgsz=imgsz,
            augment=augment,
            verbose=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc
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
            label = str(names.get(cls_id, cls_id)) if names else str(cls_id)
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
