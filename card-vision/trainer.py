"""
Train or fine-tune the card detector.

For better accuracy than a quick run:
  - Use more epochs (e.g. 80–150) if validation mAP is still improving.
  - Raise imgsz (800–1024) if GPU memory allows — helps small cards in photos.
  - Start from yolov8m.pt or yolov8l.pt instead of nano/small if you can afford train + infer time.
  - Add dataset variety: lighting, angles, backgrounds, partial occlusion, your real phone camera.
"""
from pathlib import Path

from ultralytics import YOLO

from _config import DEFAULT_WEIGHTS, ROOT

_DATASET = str(ROOT / "datasets" / "Card-Detection-12" / "data.yaml")

def train(model_path):
    if not Path(_DATASET).exists():
        raise FileNotFoundError(f"Dataset not found: {_DATASET}")
    p = Path(model_path)
    # Only validate existence for explicit file paths; bare names like "yolov8n.pt" are downloaded by YOLO.
    if (p.is_absolute() or model_path.startswith(".") or len(p.parts) > 1) and not p.is_file():
        raise FileNotFoundError(f"Model weights not found: {model_path}")
    model = YOLO(model_path)
    model.train(data=_DATASET, project=str(ROOT / "runs"), name="card-vision", epochs=30,
                imgsz=640,  # server default is 960 (set via CARD_VISION_IMGSZ); higher helps at inference
                cache="disk", batch=16, device=None, amp=False, workers=4)


def validate(model_path):
    if not Path(_DATASET).exists():
        raise FileNotFoundError(f"Dataset not found: {_DATASET}")
    if not Path(model_path).is_file():
        raise FileNotFoundError(f"Model weights not found: {model_path}")
    model = YOLO(model_path)
    metrics = model.val(data=_DATASET, device=None)
    try:
        results = {
            "map50_95": metrics.box.map,
            "map50": metrics.box.map50,
            "map75": metrics.box.map75,
            "maps": metrics.box.maps,
        }
    except AttributeError as e:
        raise RuntimeError(f"Validation metrics unavailable: {e}") from e
    for k, v in results.items():
        print(f"  {k}: {v}")
    return results

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description="Train or validate the card detector.")
    parser.add_argument("--validate", action="store_true", help="Run validation instead of training.")
    parser.add_argument("--model", default=None, help="Model weights to start from (e.g. yolov8n.pt). Defaults to trained weights.")
    args = parser.parse_args()

    if args.validate:
        if not DEFAULT_WEIGHTS.is_file():
            raise FileNotFoundError(f"No trained weights at {DEFAULT_WEIGHTS}. Train first: python trainer.py")
        validate(str(DEFAULT_WEIGHTS))
    else:
        if args.model:
            model_path = args.model
        elif DEFAULT_WEIGHTS.is_file():
            model_path = str(DEFAULT_WEIGHTS)
        else:
            raise FileNotFoundError(
                f"No trained weights at {DEFAULT_WEIGHTS}. "
                "To train from a base model, run: python trainer.py --model yolov8n.pt"
            )
        train(model_path)
