"""
Quick single-image inference for pose regression model.

경로를 코드 상단 DEFAULTS에서 바로 수정할 수 있고,
CLI 인자로도 override 가능합니다.
Usage example:
python vision/SEGU/test.py \
  --img /mnt/d/ev-auto-chargingfork/vision/SEGU/datasets/all/sample.png \
  --ckpt /mnt/d/ev-auto-chargingfork/vision/SEGU/checkpoints/best.pth \
  --backbone mobilenet_v3 \
  --pretrained /mnt/d/ev-auto-chargingfork/vision/SEGU/checkpoints/pretrain/mobilenetv3-large-1cd25616.pth
"""
import argparse
from pathlib import Path

import torch
from PIL import Image
from torchvision import transforms

from model.suPoseModel import PoseRegressor

# 기본 경로/옵션 (필요하면 여기서 직접 수정)
DEFAULTS = {
    "img": Path("/mnt/d/ev-auto-chargingfork/vision/SEGU/datasets/all/m_251203_020606020_0d008_0d038_m0d153_0d486_m0d001_0d001_0d874_0d158_1.png"),
    "ckpt": Path("/mnt/d/ev-auto-chargingfork/vision/SEGU/checkpoints/best.pth"),
    "backbone": "mobilenet_v3",
    "pretrained": Path("/mnt/d/ev-auto-chargingfork/vision/SEGU/checkpoints/pretrain/mobilenetv3-large-1cd25616.pth"),
}


def get_args():
    p = argparse.ArgumentParser()
    p.add_argument("--img", type=Path, default=DEFAULTS["img"], help="Path to test image")
    p.add_argument("--ckpt", type=Path, default=DEFAULTS["ckpt"], help="Checkpoint path (best.pth/last.pth)")
    p.add_argument("--backbone", type=str, default=DEFAULTS["backbone"], choices=["resnet18", "mobilenet_v2", "mobilenet_v3"])
    p.add_argument("--pretrained", type=Path, default=DEFAULTS["pretrained"], help="Optional pretrained backbone weights")
    return p.parse_args()


def main():
    args = get_args()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # model
    model = PoseRegressor(backbone=args.backbone, pretrained_path=str(args.pretrained) if args.pretrained else None)
    ckpt = torch.load(args.ckpt, map_location=device)
    model.load_state_dict(ckpt["model_state"])
    model.to(device).eval()

    # transform (train/eval과 동일)
    norm = transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    tf = transforms.Compose([transforms.ToTensor(), norm])

    # load image
    img = Image.open(args.img).convert("RGB")
    x = tf(img).unsqueeze(0).to(device)

    with torch.no_grad():
        pred = model(x).squeeze(0).cpu()

    pos = pred[:3].tolist()
    quat = pred[3:].tolist()
    gt = None
    try:
        name = args.img.name.replace(".png", "")
        parts = name.split("_")
        if len(parts) >= 10:
            def decode_coord(token: str) -> float:
                sign = -1.0 if token.startswith("m") else 1.0
                body = token[1:] if token.startswith("m") else token
                return sign * float(body.replace("d", "."))
            x_gt, y_gt, z_gt, qx_gt, qy_gt, qz_gt, qw_gt = parts[3:10]
            gt = [decode_coord(x_gt), decode_coord(y_gt), decode_coord(z_gt), decode_coord(qx_gt), decode_coord(qy_gt), decode_coord(qz_gt), decode_coord(qw_gt)]
    except Exception:
        gt = None

    print("Image:", args.img)
    if gt:
        print("GT   pos:", gt[:3])
        print("GT   quat(norm~1):", gt[3:])
    print("Pred pos:", pos)
    print("Pred quat(norm~1):", quat)


if __name__ == "__main__":
    main()
