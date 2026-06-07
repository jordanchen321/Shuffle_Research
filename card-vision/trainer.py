"""
Train or fine-tune the card detector.

For better accuracy than a quick run:
  - Use more epochs (e.g. 80–150) if validation mAP is still improving.
  - Raise imgsz (800–1024) if GPU memory allows — helps small cards in photos.
  - Start from yolov8m.pt or yolov8l.pt instead of nano/small if you can afford train + infer time.
  - Add dataset variety: lighting, angles, backgrounds, partial occlusion, your real phone camera.
"""
from ultralytics import YOLO

def train(model_path):
    # Load a model
    model = YOLO(model_path)  # load a pretrained model (recommended for training)

    # Use the model
    model.train(data="datasets/Card-Detection-12/data.yaml", name="card-vision", exist_ok=True, epochs=30, 
                imgsz=640, cache="ram", batch=16, device=0, amp=False, workers=4)  # train the model
    # metrics = model.val()  # evaluate model performance on the validation set
    # path = model.export(format="onnx")  # export the model to ONNX format


def validate(model_path):
    model = YOLO(model_path)
    metrics = model.val()
    metrics.box.map  # map50-95
    metrics.box.map50  # map50
    metrics.box.map75  # map75
    metrics.box.maps 

if __name__ == '__main__':
    model_path = "model-output/weights/best.pt"
    train(model_path)