import json
import os

def coco_to_yolo(json_path, output_root="datasets/EVCI/"):
    """
    COCO JSON 어노테이션을 YOLO 형식 txt 라벨로 변환
    Args:
        json_path (str): COCO JSON 파일 경로
        output_root (str): 출력 루트 폴더 (예: datasets/EVCI)
    """
    # split 구분 (train/val 자동)
    if "train" in json_path.lower() or "test" in json_path.lower():
        split_name = "train"
    elif "val" in json_path.lower() or "validate" in json_path.lower():
        split_name = "val"
    else:
        split_name = "unknown"

    labels_dir = os.path.join(output_root, "labels", split_name)
    images_dir = os.path.join(output_root, "images", split_name)
    os.makedirs(labels_dir, exist_ok=True)
    os.makedirs(images_dir, exist_ok=True)

    with open(json_path, "r") as f:
        data = json.load(f)

    # id → (w,h,file_name) 매핑
    image_info = {img["id"]: (img["width"], img["height"], img["file_name"]) for img in data["images"]}

    '''
    category id -> yolo class
    1 -> 1 (DC-) HolePairLeft
    2 -> 2 (DC+) HolePairRight
    3 -> 0 (AC) ACHole
    '''
    id_to_idx = {
    1: 1,
    2: 2,
    3: 0
    }
    
    # annotation들을 image_id별로 모으기
    grouped_anns = {}
    for ann in data["annotations"]:
        img_id = ann["image_id"]
        if img_id not in grouped_anns:
            grouped_anns[img_id] = []
        grouped_anns[img_id].append(ann)

    # 각 이미지별 라벨 파일 생성
    for img_id, anns in grouped_anns.items():
        img_w, img_h, file_name = image_info[img_id]
        label_name = os.path.splitext(file_name)[0] + ".txt"
        label_path = os.path.join(labels_dir, label_name)

        with open(label_path, "w") as f:
            for ann in anns:
                x, y, w, h = ann["bbox"]
                x_center = (x + w / 2) / img_w
                y_center = (y + h / 2) / img_h
                w /= img_w
                h /= img_h
                class_id = id_to_idx[ann["category_id"]]
                f.write(f"{class_id} {x_center:.6f} {y_center:.6f} {w:.6f} {h:.6f}\n")

    print(f"{json_path} → {split_name} 변환 완료, 저장 경로: {labels_dir}")


# ---------------- 사용 예시 ----------------
# coco_to_yolo("filename.json")
coco_to_yolo("datasets/EVCI/EVCI_A_set_Test/instances_Test.json")
coco_to_yolo("datasets/EVCI/EVCI_A_set_Validation/instances_Validate.json")
