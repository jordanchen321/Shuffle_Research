import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_WEIGHTS = ROOT / "model-output" / "weights" / "best.pt"
_raw = os.environ.get("CARD_VISION_MODEL_PATH", "").strip()
MODEL_PATH = Path(_raw) if _raw else DEFAULT_WEIGHTS
