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

_DATASET = "datasets/Card-Detection-12/data.yaml"

def train(model_path):
    if not Path(_DATASET).exists():
        raise FileNotFoundError(f"Dataset not found: {_DATASET}")
    if not Path(model_path).is_file():
        raise FileNotFoundError(f"Model weights not found: {model_path}")
    model = YOLO(model_path)
    model.train(data=_DATASET, name="card-vision", exist_ok=True, epochs=30,
                imgsz=640,  # server default is 960 (set via CARD_VISION_IMGSZ); higher helps at inference
                cache="disk", batch=16, device=0, amp=False, workers=4)


def validate(model_path):
    if not Path(model_path).is_file():
        raise FileNotFoundError(f"Model weights not found: {model_path}")
    model = YOLO(model_path)
    metrics = model.val(data=_DATASET)
    results = {
        "map50_95": metrics.box.map,
        "map50": metrics.box.map50,
        "map75": metrics.box.map75,
        "maps": metrics.box.maps,
    }
    for k, v in results.items():
        print(f"  {k}: {v}")
    return results

if __name__ == '__main__':
    model_path = "model-output/weights/best.pt"
    train(model_path)