from ultralytics import YOLO
from ultralytics import settings

print(settings)
settings["tensorboard"] = True
settings["datasets_dir"] = "datasets"

# Load a pretrained YOLO11n model
# model = YOLO("models/yolo11s.pt")
model = YOLO("runs/EVCI_train/yolo11s_setA/weights/best.pt")  # load a custom model

model.train(
    data="cfg/datasets/EVCI.yaml",
    epochs=50,
    imgsz=640,
    batch=4,
    lr0=0.001,
    project="runs/EVCI_train",  # 저장 경로 상위 폴더 변경
    name="yolo11s_setA"                  # 하위 폴더 (기본값 exp, exp2 …)

)
