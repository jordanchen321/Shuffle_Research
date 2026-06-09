import logging

import cv2
from ultralytics import YOLO

from _config import MODEL_PATH

MAX_CONSECUTIVE_ERRORS = 10


def analyze_camera():
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Could not open camera (device 0).")

    try:
        if not MODEL_PATH.is_file():
            raise FileNotFoundError(f"Model weights not found: {MODEL_PATH}")
        try:
            model = YOLO(str(MODEL_PATH))
        except Exception as e:
            raise RuntimeError(f"Failed to load model: {e}") from e

        consecutive_errors = 0
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                print("Camera read failed — stream ended or device disconnected.")
                break

            try:
                results = model(frame)
                for result in results:
                    cv2.imshow("Card-Vision", result.plot())
                consecutive_errors = 0
            except Exception as e:
                logging.exception("Inference error")
                consecutive_errors += 1
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    print("Too many consecutive inference errors — stopping.")
                    break

            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()


if __name__ == '__main__':
    analyze_camera()
