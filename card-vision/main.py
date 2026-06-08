import os
from pathlib import Path

from ultralytics import YOLO
import cv2

model_path = Path(os.environ.get("CARD_VISION_MODEL_PATH", "model-output/weights/best.pt"))
if not model_path.is_file():
    raise FileNotFoundError(f"Model weights not found: {model_path}")
model = YOLO(str(model_path))


def analyze_camera():
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("Error: could not open camera (device 0).")
        return
    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            try:
                results = model(frame)
                for result in results:
                    cv2.imshow("Card-Vision", result.plot())
            except Exception as e:
                print(f"Inference error: {e}")
                continue

            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()


if __name__ == '__main__':
    analyze_camera()
