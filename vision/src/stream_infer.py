"""
실시간 WebSocket 프레임을 위한 원샷 비전 추론 스크립트
-----------------------------------------------------------------
역할:
  - 좌/우 스테레오 이미지를 입력으로 YOLO 검출 + StereoSGBM 깊이 추정
  - 바운딩 박스 좌표/중심 깊이 로그 JSON과 미리보기 이미지를 저장
  - stdout으로 JSON 직렬화 결과를 반환 (Node 백엔드에서 파싱)

사용 예시:
  python vision/src/stream_infer.py \
    --left /tmp/left.png --right /tmp/right.png \
    --weights vision/weights/best.pt \
    --stereo-json vision/config/stereo_params.json \
    --out vision/result/stream/1699999999
"""

import argparse
import base64
import json
import os
import sys
from typing import Dict, List

import cv2
import numpy as np

from utils.yolo_run import YoloDetector
from utils.stereo_depth_run import generate_stereo_yaml_from_json, compute_depth_map


def _encode_image(path: str) -> str:
    with open(path, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode("utf-8")


def _ensure_dir(path: str):
    os.makedirs(path, exist_ok=True)


def _depth_at(depth_map: np.ndarray, x: float, y: float) -> float:
    h, w = depth_map.shape[:2]
    xi = int(max(0, min(w - 1, round(x))))
    yi = int(max(0, min(h - 1, round(y))))
    val = float(depth_map[yi, xi])
    if np.isnan(val) or np.isinf(val):
        return None
    return val


def run_inference(args: argparse.Namespace) -> Dict:
    _ensure_dir(args.out)
    calib_path = args.calib or os.path.join(args.out, "stereo_calib.yaml")
    if args.stereo_json and not os.path.exists(calib_path):
        generate_stereo_yaml_from_json(args.stereo_json, calib_path)

    detector = YoloDetector(args.weights)

    left_out = os.path.join(args.out, "left")
    right_out = os.path.join(args.out, "right")
    _ensure_dir(left_out)
    _ensure_dir(right_out)

    det = detector.run_stereo_inference(args.left, args.right, left_out, right_out)

    disp, depth_map, _ = compute_depth_map(
        args.left, args.right, calib_path, os.path.join(args.out, "depth_map.png")
    )

    boxes: List[Dict] = []
    for side in ("left", "right"):
        img_name = os.path.splitext(os.path.basename(args.left if side == "left" else args.right))[0]
        preview_path = os.path.join(args.out, side, f"{img_name}_detect.png")
        for entry in det.get(f"{side}_boxes", []):
            bbox = entry.get("bbox", [0, 0, 0, 0])
            cx = (bbox[0] + bbox[2]) / 2
            cy = (bbox[1] + bbox[3]) / 2
            boxes.append(
                {
                    "side": side,
                    "bbox": bbox,
                    "class": int(entry.get("class", -1)),
                    "confidence": float(entry.get("confidence", 0.0)),
                    "centerDepth": _depth_at(depth_map, cx, cy),
                }
            )

    preview_left = os.path.join(args.out, "left", f"{os.path.splitext(os.path.basename(args.left))[0]}_detect.png")
    preview_right = os.path.join(args.out, "right", f"{os.path.splitext(os.path.basename(args.right))[0]}_detect.png")

    log_path = os.path.join(args.out, "detections.json")
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump({"boxes": boxes}, f, indent=2)

    return {
        "boxes": boxes,
        "previews": {
            "left": _encode_image(preview_left) if os.path.exists(preview_left) else None,
            "right": _encode_image(preview_right) if os.path.exists(preview_right) else None,
        },
        "depthMap": {
            "path": os.path.join(args.out, "depth_map.png"),
            "image": _encode_image(os.path.join(args.out, "depth_map.png")),
        },
        "logPath": log_path,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stereo stream inference")
    parser.add_argument("--left", required=True, help="Left image path")
    parser.add_argument("--right", required=True, help="Right image path")
    parser.add_argument("--weights", required=True, help="YOLO weight file")
    parser.add_argument("--stereo-json", dest="stereo_json", required=False, help="Stereo json param path")
    parser.add_argument("--calib", required=False, help="Pre-generated stereo calib yaml")
    parser.add_argument("--out", required=True, help="Output directory for previews/logs")
    return parser.parse_args()


if __name__ == "__main__":
    parsed = parse_args()
    try:
        result = run_inference(parsed)
        sys.stdout.write(json.dumps(result))
    except Exception as e:
        sys.stderr.write(str(e))
        sys.exit(1)
