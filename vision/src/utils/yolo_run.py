import os
import json
from ultralytics import YOLO
import cv2


class YoloDetector:
    def __init__(self, weight_path: str):
        self.model = YOLO(weight_path)

    def infer_image(self, img_path: str, save_dir: str):
        os.makedirs(save_dir, exist_ok=True)
        img_name = os.path.basename(img_path).split('.')[0]
        save_img_path = os.path.join(save_dir, f"{img_name}_detect.png")
        save_json_path = os.path.join(save_dir, f"{img_name}_bbox.json")

        # 추론
        results = self.model(img_path)
        boxes = results[0].boxes.xyxy.cpu().numpy()
        scores = results[0].boxes.conf.cpu().numpy()
        cls = results[0].boxes.cls.cpu().numpy()

        # 결과 이미지 저장
        results[0].save(filename=save_img_path)

        # 좌표 저장
        bbox_data = []
        for (b, s, c) in zip(boxes, scores, cls):
            bbox_data.append({
                "bbox": b.tolist(),  # [x1, y1, x2, y2]
                "confidence": float(s),
                "class": int(c)
            })
        with open(save_json_path, 'w', encoding='utf-8') as f:
            json.dump(bbox_data, f, indent=2)

        return bbox_data

    def run_stereo_inference(self, left_img_path: str, right_img_path: str,
                             left_out_dir: str, right_out_dir: str):
        left_boxes = self.infer_image(left_img_path, left_out_dir)
        right_boxes = self.infer_image(right_img_path, right_out_dir)

        return {
            "left_boxes": left_boxes,
            "right_boxes": right_boxes
        }


if __name__ == "__main__":

    WEIGHT_PATH = "vision/weights/best.pt"
    LEFT_IMG = "vision/image/original_left_view/left_view.png"
    RIGHT_IMG = "vision/image/original_right_view/right_view.png"
    LEFT_OUT = "vision/image/detect_left_view"
    RIGHT_OUT = "vision/image/detect_right_view"

    detector = YoloDetector(WEIGHT_PATH)
    result = detector.run_stereo_inference(LEFT_IMG, RIGHT_IMG, LEFT_OUT, RIGHT_OUT)

    print("\n[RESULT]")
    print(json.dumps(result, indent=2))
