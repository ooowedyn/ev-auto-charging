"""
Minimal standalone training script (no external config).
- Data: vision/SEGU/datasets/all/*.png
- Split: train/val/test = 0.7/0.1/0.2 (seed 고정 random split)
- Outputs: checkpoints → vision/SEGU/checkpoints/
           tensorboard → vision/SEGU/logs/tensorboard/
           csv logs → vision/SEGU/logs/csv/

전역 DEFAULTS만 수정해도 설정을 바꿀 수 있고, CLI 인자로도 override 가능합니다.
"""
import argparse
import csv
import os, sys
import random
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset
from torch.utils.tensorboard import SummaryWriter
from torchvision import transforms
from PIL import Image
from tqdm.auto import tqdm

from model.suPoseModel import PoseRegressor

# -------------------------
# Global defaults (edit here if 필요한 경우)
# -------------------------
DEFAULTS = {
    "data_dir": Path("/mnt/d/ev-auto-chargingfork/vision/SEGU/datasets/all"),
    "epochs": 50,
    "batch_size": 16,
    "lr": 1e-4,
    "img_size": 256,
    "num_workers": 4,
    "ckpt_dir": Path("/mnt/d/ev-auto-chargingfork/vision/SEGU/checkpoints"),
    "log_tb": Path("/mnt/d/ev-auto-chargingfork/vision/SEGU/logs/tensorboard"),
    "log_csv": Path("/mnt/d/ev-auto-chargingfork/vision/SEGU/logs/csv"),
    "seed": 42,
    "backbone": "mobilenet_v3",
    "pretrained_path": "/mnt/d/ev-auto-chargingfork/vision/SEGU/checkpoints/pretrain/mobilenetv3-large-1cd25616.pth",
}


# -------------------------
# Utils
# -------------------------
def seed_everything(seed: int = 42):
    random.seed(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = True


def decode_coord(token: str) -> float:
    sign = -1.0 if token.startswith("m") else 1.0
    body = token[1:] if token.startswith("m") else token
    return sign * float(body.replace("d", "."))


def parse_pose_from_name(path: Path):
    """
    Parse 7D pose from filename:
    {side}_{date}_{time}_{x}_{y}_{z}_{qx}_{qy}_{qz}_{qw}_{dist}_{visible}.png
    """
    name = path.name.replace(".png", "")
    parts = name.split("_")
    if len(parts) < 10:
        raise ValueError(f"Unexpected filename format: {path}")
    x, y, z, qx, qy, qz, qw = parts[3:10]
    return np.array(
        [decode_coord(x), decode_coord(y), decode_coord(z), decode_coord(qx), decode_coord(qy), decode_coord(qz), decode_coord(qw)],
        dtype=np.float32,
    )


# -------------------------
# Dataset using split CSV
# -------------------------
class PoseDataset(Dataset):
    def __init__(self, paths, transform):
        self.paths = list(paths)
        if not self.paths:
            raise RuntimeError("Empty dataset.")
        self.transform = transform

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, idx):
        img_path = Path(self.paths[idx])
        img = Image.open(img_path).convert("RGB")
        if self.transform:
            img = self.transform(img)
        pose_np = parse_pose_from_name(img_path)
        pose = torch.tensor(pose_np, dtype=torch.float32)
        # normalize quaternion part (safety)
        quat = pose[3:]
        norm = torch.norm(quat) + 1e-8
        pose[3:] = quat / norm
        return img, pose  # input, pose


def get_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data_dir", type=Path, default=DEFAULTS["data_dir"], help="Folder with *.png images")
    p.add_argument("--epochs", type=int, default=DEFAULTS["epochs"])
    p.add_argument("--batch_size", type=int, default=DEFAULTS["batch_size"])
    p.add_argument("--lr", type=float, default=DEFAULTS["lr"])
    p.add_argument("--num_workers", type=int, default=DEFAULTS["num_workers"])
    p.add_argument("--ckpt_dir", type=Path, default=DEFAULTS["ckpt_dir"])
    p.add_argument("--log_tb", type=Path, default=DEFAULTS["log_tb"])
    p.add_argument("--log_csv", type=Path, default=DEFAULTS["log_csv"])
    p.add_argument("--seed", type=int, default=DEFAULTS["seed"])
    p.add_argument("--backbone", type=str, default=DEFAULTS["backbone"], choices=["resnet18", "mobilenet_v2", "mobilenet_v3"])
    p.add_argument("--pretrained_path", type=str, default=DEFAULTS["pretrained_path"])
    p.add_argument("--weight_decay", type=float, default=1e-4)
    return p.parse_args()


def main():
    args = get_args()
    seed_everything(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[INFO] device: {device}")

    # random split with seed
    img_paths = sorted(Path(args.data_dir).glob("*.png"))
    if not img_paths:
        raise RuntimeError(f"No images found in {args.data_dir}")
    seed_everything(args.seed)
    random.shuffle(img_paths)
    n = len(img_paths)
    n_train = int(n * 0.7)
    n_val = int(n * 0.1)
    n_test = n - n_train - n_val
    train_paths = img_paths[:n_train]
    val_paths = img_paths[n_train:n_train + n_val]
    test_paths = img_paths[n_train + n_val:]

    # transforms
    norm = transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    train_tf = transforms.Compose(
        [
            transforms.ToTensor(),
            transforms.ColorJitter(brightness=0.1, contrast=0.1, saturation=0.1, hue=0.02),
            transforms.GaussianBlur(kernel_size=3, sigma=(0.1, 1.0)),
            norm,
        ]
    )
    eval_tf = transforms.Compose([transforms.ToTensor(), norm])

    # dataset
    train_ds = PoseDataset(train_paths, transform=train_tf)
    val_ds = PoseDataset(val_paths, transform=eval_tf)
    test_ds = PoseDataset(test_paths, transform=eval_tf)

    def worker_init_fn(worker_id):
        seed = args.seed + worker_id
        np.random.seed(seed)
        random.seed(seed)

    train_loader = DataLoader(
        train_ds,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        pin_memory=True,
        worker_init_fn=worker_init_fn,
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        pin_memory=True,
        worker_init_fn=worker_init_fn,
    )
    test_loader = DataLoader(
        test_ds,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        pin_memory=True,
        worker_init_fn=worker_init_fn,
    )

    model = PoseRegressor(backbone=args.backbone, pretrained_path=args.pretrained_path).to(device)
    if torch.cuda.is_available() and torch.cuda.device_count() > 1:
        model = nn.DataParallel(model)
        print(f"[INFO] Using DataParallel ({torch.cuda.device_count()} GPUs)")

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    pos_w = 1.0
    ori_w = 1.0

    # logging dirs
    args.ckpt_dir.mkdir(parents=True, exist_ok=True)
    args.log_tb.mkdir(parents=True, exist_ok=True)
    args.log_csv.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    tb_writer = SummaryWriter(log_dir=str(args.log_tb / timestamp))
    csv_path = args.log_csv / f"train_{timestamp}.csv"
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    csv_file = open(csv_path, "w")
    csv_file.write("epoch,train_total,train_pos,train_ori,val_total,val_pos,val_ori,lr\n")

    best_val = float("inf")
    for epoch in range(1, args.epochs + 1):
        model.train()
        train_total = 0.0
        train_pos_sum = 0.0
        train_ori_sum = 0.0
        for imgs, poses in tqdm(train_loader, desc=f"Train {epoch}", leave=False):
            imgs = imgs.to(device)
            poses = poses.to(device)
            opt.zero_grad()
            preds = model(imgs)
            pos_loss = torch.nn.functional.smooth_l1_loss(preds[:, :3], poses[:, :3])
            q_pred = preds[:, 3:]
            q_gt = poses[:, 3:]
            dot = torch.sum(q_pred * q_gt, dim=1).clamp(-1.0, 1.0)
            ori_loss = torch.mean(1.0 - torch.abs(dot))
            loss = pos_w * pos_loss + ori_w * ori_loss
            loss.backward()
            opt.step()
            bsz = imgs.size(0)
            train_total += loss.item() * bsz
            train_pos_sum += pos_loss.item() * bsz
            train_ori_sum += ori_loss.item() * bsz
        train_total /= len(train_loader.dataset)
        train_pos_mean = train_pos_sum / len(train_loader.dataset)
        train_ori_mean = train_ori_sum / len(train_loader.dataset)

        model.eval()
        val_total = 0.0
        val_pos_sum = 0.0
        val_ori_sum = 0.0
        with torch.no_grad():
            for imgs, poses in tqdm(val_loader, desc=f"Val   {epoch}", leave=False):
                imgs = imgs.to(device)
                poses = poses.to(device)
                preds = model(imgs)
                pos_loss = torch.nn.functional.smooth_l1_loss(preds[:, :3], poses[:, :3])
                q_pred = preds[:, 3:]
                q_gt = poses[:, 3:]
                dot = torch.sum(q_pred * q_gt, dim=1).clamp(-1.0, 1.0)
                ori_loss = torch.mean(1.0 - torch.abs(dot))
                loss = pos_w * pos_loss + ori_w * ori_loss
                bsz = imgs.size(0)
                val_total += loss.item() * bsz
                val_pos_sum += pos_loss.item() * bsz
                val_ori_sum += ori_loss.item() * bsz
        val_total /= len(val_loader.dataset)
        val_pos_mean = val_pos_sum / len(val_loader.dataset)
        val_ori_mean = val_ori_sum / len(val_loader.dataset)

        tb_writer.add_scalars(
            "loss",
            {
                "train_total": train_total,
                "val_total": val_total,
                "train_pos": train_pos_mean,
                "train_ori": train_ori_mean,
                "val_pos": val_pos_mean,
                "val_ori": val_ori_mean,
            },
            epoch,
        )
        tb_writer.add_scalar("lr", opt.param_groups[0]["lr"], epoch)
        csv_file.write(f"{epoch},{train_total:.6f},{train_pos_mean:.6f},{train_ori_mean:.6f},{val_total:.6f},{val_pos_mean:.6f},{val_ori_mean:.6f},{opt.param_groups[0]['lr']:.6e}\n")
        csv_file.flush()

        print(f"[Epoch {epoch:03d}] train_total={train_total:.6f} (pos={train_pos_mean:.6f}, ori={train_ori_mean:.6f}) val_total={val_total:.6f} (pos={val_pos_mean:.6f}, ori={val_ori_mean:.6f})")

        # save last checkpoint
        ckpt_last = args.ckpt_dir / "last.pth"
        torch.save(
            {"epoch": epoch, "model_state": model.state_dict(), "optimizer_state": opt.state_dict(), "best_val": best_val},
            ckpt_last,
        )

        if val_total < best_val:
            best_val = val_total
            ckpt_path = args.ckpt_dir / "best.pth"
            torch.save(
                {"epoch": epoch, "model_state": model.state_dict(), "optimizer_state": opt.state_dict(), "best_val": best_val},
                ckpt_path,
            )
            print(f"[INFO] Saved best checkpoint to {ckpt_path}")

    # test loss (참고용)
    model.eval()
    test_total = 0.0
    test_pos_sum = 0.0
    test_ori_sum = 0.0
    test_trans_err_sum = 0.0
    test_rot_deg_sum = 0.0
    test_count = 0
    with torch.no_grad():
        for imgs, poses in tqdm(test_loader, desc="Test", leave=False):
            imgs = imgs.to(device)
            poses = poses.to(device)
            preds = model(imgs)
            pos_loss = torch.nn.functional.smooth_l1_loss(preds[:, :3], poses[:, :3])
            q_pred = preds[:, 3:]
            q_gt = poses[:, 3:]
            dot = torch.sum(q_pred * q_gt, dim=1).clamp(-1.0, 1.0)
            ori_loss = torch.mean(1.0 - torch.abs(dot))
            loss = pos_w * pos_loss + ori_w * ori_loss
            bsz = imgs.size(0)
            test_total += loss.item() * bsz
            test_pos_sum += pos_loss.item() * bsz
            test_ori_sum += ori_loss.item() * bsz
            # translation/rotation error (mean over batch)
            trans_err = torch.norm(preds[:, :3] - poses[:, :3], dim=1)  # L2 per sample
            rot_deg = torch.acos(torch.clamp(torch.abs(dot), -1.0, 1.0)) * 2 * 180.0 / torch.pi
            test_trans_err_sum += trans_err.sum().item()
            test_rot_deg_sum += rot_deg.sum().item()
            test_count += bsz
    test_total /= len(test_loader.dataset)
    test_pos_mean = test_pos_sum / len(test_loader.dataset)
    test_ori_mean = test_ori_sum / len(test_loader.dataset)
    test_trans_mean = test_trans_err_sum / max(test_count, 1)
    test_rot_mean = test_rot_deg_sum / max(test_count, 1)
    print(f"[TEST] total={test_total:.6f} (pos={test_pos_mean:.6f}, ori={test_ori_mean:.6f}) "
          f"| trans_err={test_trans_mean:.6f}m rot_err={test_rot_mean:.3f}deg")

    csv_file.close()
    tb_writer.close()


if __name__ == "__main__":
    main()
