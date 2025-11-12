from ultralytics import YOLO

# Load a model
# model = YOLO("yolo11s.pt")  # load an official model
model = YOLO("runs/EVCI_train/yolo11s_setA2/weights/best.pt")  # load a custom model

# Validate the model
metrics = model.val()  # no arguments needed, dataset and settings remembered
# metrics.box.map  # map50-95
# metrics.box.map50  # map50
# metrics.box.map75  # map75
# metrics.box.maps  # a list contains map50-95 of each category

# Run batched inference on a list of images
results = model(["datasets/EVCI/EVCI_B_set_Test/img/BoltEV_White_2019_Rainy_Time(20200722)_Morning_OutsideB_DC_Off_color002.png",
                 "datasets/EVCI/EVCI_B_set_Test/img/BoltEV_White_2019_Rainy_Time(20200722)_Morning_OutsideB_DC_Off_color017.png"])  # return a list of Results objects

# Process results list
for result in results:
    boxes = result.boxes  # Boxes object for bounding box outputs
    masks = result.masks  # Masks object for segmentation masks outputs
    keypoints = result.keypoints  # Keypoints object for pose outputs
    probs = result.probs  # Probs object for classification outputs
    obb = result.obb  # Oriented boxes object for OBB outputs
    result.show()  # display to screen
    result.save(filename="result.jpg")  # save to disk