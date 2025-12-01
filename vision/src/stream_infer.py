import argparse
import json
import sys
import base64
import cv2
import numpy as np

try:
    from ultralytics import YOLO
except Exception as e:  # pragma: no cover
    sys.stderr.write(f"[stream_infer] ultralytics import failed: {e}\n")
    sys.exit(1)


def decode_base64_to_image(b64str: str):
    arr = np.frombuffer(base64.b64decode(b64str), np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode base64 image")
    return img


def run_detection(model_or_path, left_path=None, left_b64=None):
    model = model_or_path if isinstance(model_or_path, YOLO) else YOLO(model_or_path)
    if left_b64:
        img = decode_base64_to_image(left_b64)
        res = model(img, imgsz=640, conf=0.25, verbose=False)[0]
    else:
        res = model(left_path, imgsz=640, conf=0.25, verbose=False)[0]
    boxes = []
    for b in res.boxes:
        xyxy = b.xyxy[0].tolist()
        boxes.append(
            {
                "x1": xyxy[0],
                "y1": xyxy[1],
                "x2": xyxy[2],
                "y2": xyxy[3],
                "conf": float(b.conf.item()) if hasattr(b.conf, "item") else float(b.conf),
                "cls": int(b.cls.item()) if hasattr(b.cls, "item") else int(b.cls),
            }
        )
    return {
        "boxes": boxes,
        "imgW": int(res.orig_shape[1]),
        "imgH": int(res.orig_shape[0]),
        "names": res.names,
    }


def main():
    parser = argparse.ArgumentParser(description="Stereo frame YOLO inference (left only)")
    parser.add_argument("--left", help="Left image path")
    parser.add_argument("--weights", required=True, help="YOLO weights (pt)")
    parser.add_argument("--out", help="Output dir (unused)", default=None)
    parser.add_argument("--stdin-b64", action="store_true", help="Read left image base64 from stdin")
    parser.add_argument("--stdin-loop", action="store_true", help="Keep process alive and read JSON lines {\"image\":b64}")
    args = parser.parse_args()

    if args.stdin_loop:
        model = YOLO(args.weights)
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
                b64 = payload.get("image") or ""
                result = run_detection(model, left_b64=b64)
                sys.stdout.write(json.dumps(result) + "\n")
                sys.stdout.flush()
            except Exception as e:  # pragma: no cover
                sys.stderr.write(f"[stream_infer] loop error: {e}\n")
                sys.stderr.flush()
        return

    left_b64 = sys.stdin.read().strip() if args.stdin_b64 else None
    result = run_detection(args.weights, left_path=args.left, left_b64=left_b64)
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
