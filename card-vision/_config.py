import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_WEIGHTS = ROOT / "model-output" / "weights" / "best.pt"
MODEL_PATH = Path(os.environ.get("CARD_VISION_MODEL_PATH", str(DEFAULT_WEIGHTS)))
