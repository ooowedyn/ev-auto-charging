import argparse
import base64
import io
import json
import os
import sys

import torch
from PIL import Image
from torchvision import transforms
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # vision/
sys.path.append(str(ROOT))
sys.path.append(str(ROOT / "SEGU" / "model"))  # for mobilenetv3 import
from SEGU.model.suPoseModel import PoseRegressor  # noqa: E402

# 학습 시 pos_scale(예: 100)로 좌표를 스케일했다면 추론 시 되돌림
POS_SCALE = float(os.getenv("POSE_POS_SCALE", "100.0"))


def decode_image(b64str: str) -> Image.Image:
    buf = base64.b64decode(b64str)
    return Image.open(io.BytesIO(buf)).convert("RGB")


def load_model(weights_path: str, device: str = "cpu"):
    checkpoint = torch.load(weights_path, map_location=device)
    model = PoseRegressor(backbone="mobilenet_v3", pretrained_path=None)
    # 다양한 저장 형식 지원: model_state / model / state_dict / raw
    if isinstance(checkpoint, dict):
        if "model_state" in checkpoint:
            state = checkpoint["model_state"]
        elif "model" in checkpoint:
            state = checkpoint["model"]
        elif "state_dict" in checkpoint:
            state = checkpoint["state_dict"]
        else:
            state = checkpoint
    else:
        state = checkpoint
    missing, unexpected = model.load_state_dict(state, strict=False)
    if missing or unexpected:
        sys.stderr.write(f"[poseInfer] loaded with missing={len(missing)}, unexpected={len(unexpected)}\n")
    model.to(device)
    model.eval()
    return model


def preprocess(img: Image.Image):
    tfm = transforms.Compose(
        [
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )
    return tfm(img).unsqueeze(0)


def run_once(model, device, b64_image: str):
    img = decode_image(b64_image)
    tensor = preprocess(img).to(device)
    with torch.no_grad():
        pred = model(tensor)
    arr = pred.squeeze(0).cpu().numpy()
    arr[:3] = arr[:3] / POS_SCALE  # 좌표 스케일 복원 (m 단위)
    return arr.tolist()


def main():
    parser = argparse.ArgumentParser(description="Pose regression inference worker")
    parser.add_argument("--weights", required=True, help="Path to best.pth checkpoint")
    parser.add_argument("--stdin-loop", action="store_true", help="Keep process alive and read JSON lines")
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = load_model(args.weights, device)

    if args.stdin_loop:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
                b64 = payload.get("image") or ""
                pred = run_once(model, device, b64)
                sys.stdout.write(json.dumps({"pred": pred}) + "\n")
                sys.stdout.flush()
            except Exception as e:  # pragma: no cover
                sys.stderr.write(f"[poseInfer] error: {e}\n")
                sys.stderr.flush()
        return

    # single run (stdin one image)
    b64 = sys.stdin.read().strip()
    if not b64:
        raise RuntimeError("No image provided on stdin")
    pred = run_once(model, device, b64)
    sys.stdout.write(json.dumps({"pred": pred}))


if __name__ == "__main__":
    main()
