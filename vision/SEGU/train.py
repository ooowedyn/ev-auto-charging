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
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
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
    "epochs": 30,
    "batch_size": 32,
    "lr": 1e-4,
    "img_size": 256,
    "num_workers": 4,
    "ckpt_dir": Path("/mnt/d/ev-auto-chargingfork/vision/SEGU/checkpoints"),
    "log_root": Path("/mnt/d/ev-auto-chargingfork/vision/SEGU/logs"),
    "seed": 42,
    "backbone": "mobilenet_v3",
    "pretrained_path": "/mnt/d/ev-auto-chargingfork/vision/SEGU/checkpoints/pretrain/mobilenetv3-large-1cd25616.pth",
    "run_name": "mobienetv3_scale100_epoch30_datav2",
    "pos_scale": 100.0,   # 🔹 위치를 m → cm 단위로 스케일 (정밀도 향상용)
    "mse_after": 20,      # 🔸 (deprecated) SmoothL1만 사용 중
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
        [
            decode_coord(x),
            decode_coord(y),
            decode_coord(z),
            decode_coord(qx),
            decode_coord(qy),
            decode_coord(qz),
            decode_coord(qw),
        ],
        dtype=np.float32,
    )


# -------------------------
# Dataset using split CSV
# -------------------------
class PoseDataset(Dataset):
    def __init__(self, paths, transform, pos_scale: float = 1.0):
        self.paths = list(paths)
        if not self.paths:
            raise RuntimeError("Empty dataset.")
        self.transform = transform
        self.pos_scale = pos_scale

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, idx):
        img_path = Path(self.paths[idx])
        img = Image.open(img_path).convert("RGB")
        if self.transform:
            img = self.transform(img)

        pose_np = parse_pose_from_name(img_path)  # [x, y, z, qx, qy, qz, qw] (m, unit quat)
        # 🔹 위치만 스케일 (예: m → cm), 쿼터니언은 그대로
        pose_np[:3] *= self.pos_scale

        pose = torch.tensor(pose_np, dtype=torch.float32)

        # normalize quaternion part (safety, GT는 항상 unit)
        quat = pose[3:]
        norm = torch.norm(quat) + 1e-8
        pose[3:] = quat / norm

        return img, pose  # input, scaled pose


def get_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data_dir", type=Path, default=DEFAULTS["data_dir"], help="Folder with *.png images")
    p.add_argument("--epochs", type=int, default=DEFAULTS["epochs"])
    p.add_argument("--batch_size", type=int, default=DEFAULTS["batch_size"])
    p.add_argument("--lr", type=float, default=DEFAULTS["lr"])
    p.add_argument("--num_workers", type=int, default=DEFAULTS["num_workers"])
    p.add_argument("--ckpt_dir", type=Path, default=DEFAULTS["ckpt_dir"])
    p.add_argument("--log_root", type=Path, default=DEFAULTS["log_root"])
    p.add_argument("--seed", type=int, default=DEFAULTS["seed"])
    p.add_argument("--backbone", type=str, default=DEFAULTS["backbone"], choices=["mobilenet_v2", "mobilenet_v3"])
    p.add_argument("--pretrained_path", type=str, default=DEFAULTS["pretrained_path"])
    p.add_argument("--weight_decay", type=float, default=1e-4)
    p.add_argument("--run_name", type=str, default=DEFAULTS["run_name"], help="Prefix for run folder/files (e.g., mobv3)")
    p.add_argument("--pos_scale", type=float, default=DEFAULTS["pos_scale"], help="Scale factor for position (e.g., 100.0 for m→cm)")
    p.add_argument("--mse_after", type=int, default=DEFAULTS["mse_after"], help="(deprecated) SmoothL1 only")
    return p.parse_args()


def main():
    args = get_args()
    seed_everything(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[INFO] device: {device}")
    print(f"[INFO] pos_scale={args.pos_scale}, loss=SmoothL1 (mse_after ignored)")

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
    val_paths = img_paths[n_train : n_train + n_val]
    test_paths = img_paths[n_train + n_val :]

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
    train_ds = PoseDataset(train_paths, transform=train_tf, pos_scale=args.pos_scale)
    val_ds = PoseDataset(val_paths, transform=eval_tf, pos_scale=args.pos_scale)
    test_ds = PoseDataset(test_paths, transform=eval_tf, pos_scale=args.pos_scale)

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

    # 🔹 위치/자세 로스 가중치 (angle 기반, 추가 스케일 없음)
    pos_w = 2.0
    ori_w = 4.0

    # logging dirs with run name (logs/run_id/ 내부에 csv, tensorboard event, figs 모두 저장)
    timestamp = datetime.now().strftime("%y%m%d_%H%M%S")
    run_id = f"{args.run_name}_{timestamp}"
    log_dir = Path(args.log_root) / run_id
    ckpt_run_dir = Path(args.ckpt_dir) / run_id
    # 동일 run_id 경로가 남아 있으면 싹 비우고 새로 생성 (이벤트 파일 1개만 유지)
    if log_dir.exists():
        shutil.rmtree(log_dir, ignore_errors=True)
    log_dir.mkdir(parents=True, exist_ok=True)
    ckpt_run_dir.mkdir(parents=True, exist_ok=True)

    tb_writer = SummaryWriter(log_dir=str(log_dir))
    csv_path = log_dir / f"{run_id}.csv"
    csv_file = open(csv_path, "w")
    csv_file.write(
        "epoch,"
        "train_total,train_pos,train_ori,train_trans_m,train_rot_deg,"
        "train_mae_x,train_mae_y,train_mae_z,train_mae_qx,train_mae_qy,train_mae_qz,train_mae_qw,"
        "val_total,val_pos,val_ori,val_trans_m,val_rot_deg,"
        "val_mae_x,val_mae_y,val_mae_z,val_mae_qx,val_mae_qy,val_mae_qz,val_mae_qw,"
        "lr\n"
    )

    best_val = float("inf")

    for epoch in range(1, args.epochs + 1):
        model.train()
        train_total = 0.0
        train_pos_sum = 0.0
        train_ori_sum = 0.0
        train_trans_sum = 0.0
        train_rot_deg_sum = 0.0
        train_mae_pos_sum = torch.zeros(3, device=device)
        train_mae_quat_sum = torch.zeros(4, device=device)

        for imgs, poses in tqdm(train_loader, desc=f"Train {epoch}", leave=False):
            imgs = imgs.to(device)
            poses = poses.to(device)
            opt.zero_grad()

            preds = model(imgs)  # preds[:, :3]는 스케일된 좌표 (× pos_scale)

            # 🔹 위치 loss (SmoothL1 유지)
            pos_loss = F.smooth_l1_loss(preds[:, :3], poses[:, :3])

            # 🔹 회전 loss (쿼터니언 각도 기반)
            q_pred = preds[:, 3:]
            q_gt = poses[:, 3:]
            dot = torch.sum(q_pred * q_gt, dim=1)
            eps = 1e-4
            dot = torch.clamp(torch.abs(dot), 0.0, 1.0 - eps)  # 수치 안정화 및 acos(1) 근처 방지

            angle = 2.0 * torch.acos(dot)          # [0, π] rad
            ori_loss = (angle ** 2).mean()         # angle 제곱으로 작은 각도 gradient 완화

            loss = pos_w * pos_loss + ori_w * ori_loss
            loss.backward()
            opt.step()

            bsz = imgs.size(0)
            train_total += loss.item() * bsz
            train_pos_sum += pos_loss.item() * bsz
            train_ori_sum += ori_loss.item() * bsz

            # 🔹 메트릭은 m 단위로 계산 (스케일 되돌림)
            pred_pos_m = preds[:, :3] / args.pos_scale
            gt_pos_m = poses[:, :3] / args.pos_scale

            trans_err = torch.norm(pred_pos_m - gt_pos_m, dim=1)  # L2 (m)
            rot_deg = angle * 180.0 / torch.pi                    # rad → deg

            train_trans_sum += trans_err.sum().item()
            train_rot_deg_sum += rot_deg.sum().item()

            train_mae_pos_sum += torch.sum(torch.abs(pred_pos_m - gt_pos_m), dim=0)
            train_mae_quat_sum += torch.sum(torch.abs(preds[:, 3:] - poses[:, 3:]), dim=0)

        train_total /= len(train_loader.dataset)
        train_pos_mean = train_pos_sum / len(train_loader.dataset)
        train_ori_mean = train_ori_sum / len(train_loader.dataset)
        train_trans_mean = train_trans_sum / len(train_loader.dataset)
        train_rot_mean = train_rot_deg_sum / len(train_loader.dataset)
        train_mae_pos = (train_mae_pos_sum / len(train_loader.dataset)).tolist()
        train_mae_quat = (train_mae_quat_sum / len(train_loader.dataset)).tolist()

        # -------------------- VAL --------------------
        model.eval()
        val_total = 0.0
        val_pos_sum = 0.0
        val_ori_sum = 0.0
        val_trans_sum = 0.0
        val_rot_deg_sum = 0.0
        val_mae_pos_sum = torch.zeros(3, device=device)
        val_mae_quat_sum = torch.zeros(4, device=device)

        with torch.no_grad():
            for imgs, poses in tqdm(val_loader, desc=f"Val   {epoch}", leave=False):
                imgs = imgs.to(device)
                poses = poses.to(device)

                preds = model(imgs)

                pos_loss = F.smooth_l1_loss(preds[:, :3], poses[:, :3])

                q_pred = preds[:, 3:]
                q_gt = poses[:, 3:]
                dot = torch.sum(q_pred * q_gt, dim=1)
                eps = 1e-4
                dot = torch.clamp(torch.abs(dot), 0.0, 1.0 - eps)

                angle = 2.0 * torch.acos(dot)          # [0, π] rad
                ori_loss = (angle ** 2).mean()

                loss = pos_w * pos_loss + ori_w * ori_loss

                bsz = imgs.size(0)
                val_total += loss.item() * bsz
                val_pos_sum += pos_loss.item() * bsz
                val_ori_sum += ori_loss.item() * bsz

                pred_pos_m = preds[:, :3] / args.pos_scale
                gt_pos_m = poses[:, :3] / args.pos_scale

                trans_err = torch.norm(pred_pos_m - gt_pos_m, dim=1)
                rot_deg = angle * 180.0 / torch.pi

                val_trans_sum += trans_err.sum().item()
                val_rot_deg_sum += rot_deg.sum().item()

                val_mae_pos_sum += torch.sum(torch.abs(pred_pos_m - gt_pos_m), dim=0)
                val_mae_quat_sum += torch.sum(torch.abs(preds[:, 3:] - poses[:, 3:]), dim=0)

        val_total /= len(val_loader.dataset)
        val_pos_mean = val_pos_sum / len(val_loader.dataset)
        val_ori_mean = val_ori_sum / len(val_loader.dataset)
        val_trans_mean = val_trans_sum / len(val_loader.dataset)
        val_rot_mean = val_rot_deg_sum / len(val_loader.dataset)
        val_mae_pos = (val_mae_pos_sum / len(val_loader.dataset)).tolist()
        val_mae_quat = (val_mae_quat_sum / len(val_loader.dataset)).tolist()

        # -------------------- LOGGING --------------------
        tb_writer.add_scalar("loss/train_total", train_total, epoch)
        tb_writer.add_scalar("loss/val_total", val_total, epoch)
        tb_writer.add_scalar("loss/train_pos", train_pos_mean, epoch)
        tb_writer.add_scalar("loss/val_pos", val_pos_mean, epoch)
        tb_writer.add_scalar("loss/train_ori", train_ori_mean, epoch)
        tb_writer.add_scalar("loss/val_ori", val_ori_mean, epoch)
        tb_writer.add_scalar("err/train_trans_m", train_trans_mean, epoch)
        tb_writer.add_scalar("err/val_trans_m", val_trans_mean, epoch)
        tb_writer.add_scalar("err/train_rot_deg", train_rot_mean, epoch)
        tb_writer.add_scalar("err/val_rot_deg", val_rot_mean, epoch)

        tb_writer.add_scalar("mae_pos/train_x", train_mae_pos[0], epoch)
        tb_writer.add_scalar("mae_pos/train_y", train_mae_pos[1], epoch)
        tb_writer.add_scalar("mae_pos/train_z", train_mae_pos[2], epoch)
        tb_writer.add_scalar("mae_pos/val_x", val_mae_pos[0], epoch)
        tb_writer.add_scalar("mae_pos/val_y", val_mae_pos[1], epoch)
        tb_writer.add_scalar("mae_pos/val_z", val_mae_pos[2], epoch)

        tb_writer.add_scalar("mae_quat/train_qx", train_mae_quat[0], epoch)
        tb_writer.add_scalar("mae_quat/train_qy", train_mae_quat[1], epoch)
        tb_writer.add_scalar("mae_quat/train_qz", train_mae_quat[2], epoch)
        tb_writer.add_scalar("mae_quat/train_qw", train_mae_quat[3], epoch)
        tb_writer.add_scalar("mae_quat/val_qx", val_mae_quat[0], epoch)
        tb_writer.add_scalar("mae_quat/val_qy", val_mae_quat[1], epoch)
        tb_writer.add_scalar("mae_quat/val_qz", val_mae_quat[2], epoch)
        tb_writer.add_scalar("mae_quat/val_qw", val_mae_quat[3], epoch)
        tb_writer.add_scalar("lr", opt.param_groups[0]["lr"], epoch)

        csv_file.write(
            f"{epoch},"
            f"{train_total:.6f},{train_pos_mean:.6f},{train_ori_mean:.6f},{train_trans_mean:.6f},{train_rot_mean:.6f},"
            f"{train_mae_pos[0]:.6f},{train_mae_pos[1]:.6f},{train_mae_pos[2]:.6f},"
            f"{train_mae_quat[0]:.6f},{train_mae_quat[1]:.6f},{train_mae_quat[2]:.6f},{train_mae_quat[3]:.6f},"
            f"{val_total:.6f},{val_pos_mean:.6f},{val_ori_mean:.6f},{val_trans_mean:.6f},{val_rot_mean:.6f},"
            f"{val_mae_pos[0]:.6f},{val_mae_pos[1]:.6f},{val_mae_pos[2]:.6f},"
            f"{val_mae_quat[0]:.6f},{val_mae_quat[1]:.6f},{val_mae_quat[2]:.6f},{val_mae_quat[3]:.6f},"
            f"{opt.param_groups[0]['lr']:.6e}\n"
        )
        csv_file.flush()

        print(
            f"[Epoch {epoch:03d}] "
            f"train_total={train_total:.6f} (pos={train_pos_mean:.6f}, ori={train_ori_mean:.6f}) "
            f"val_total={val_total:.6f} (pos={val_pos_mean:.6f}, ori={val_ori_mean:.6f}) "
            f"| train_trans={train_trans_mean:.6f}m val_trans={val_trans_mean:.6f}m "
            f"train_rot={train_rot_mean:.3f}deg val_rot={val_rot_mean:.3f}deg (SmoothL1)"
        )

        # save last checkpoint
        ckpt_last = ckpt_run_dir / "last.pth"
        torch.save(
            {"epoch": epoch, "model_state": model.state_dict(), "optimizer_state": opt.state_dict(), "best_val": best_val},
            ckpt_last,
        )

        if val_total < best_val:
            best_val = val_total
            ckpt_path = ckpt_run_dir / "best.pth"
            torch.save(
                {"epoch": epoch, "model_state": model.state_dict(), "optimizer_state": opt.state_dict(), "best_val": best_val},
                ckpt_path,
            )
            print(f"[INFO] Saved best checkpoint to {ckpt_path}")

    # -------------------- TEST --------------------
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

            pos_loss = F.smooth_l1_loss(preds[:, :3], poses[:, :3])

            q_pred = preds[:, 3:]
            q_gt = poses[:, 3:]
            dot = torch.sum(q_pred * q_gt, dim=1)
            eps = 1e-4
            dot = torch.clamp(torch.abs(dot), 0.0, 1.0 - eps)
            angle = 2.0 * torch.acos(dot)  # [0, π] rad
            ori_loss = (angle ** 2).mean()
            loss = pos_w * pos_loss + ori_w * ori_loss

            bsz = imgs.size(0)
            test_total += loss.item() * bsz
            test_pos_sum += pos_loss.item() * bsz
            test_ori_sum += ori_loss.item() * bsz

            pred_pos_m = preds[:, :3] / args.pos_scale
            gt_pos_m = poses[:, :3] / args.pos_scale

            trans_err = torch.norm(pred_pos_m - gt_pos_m, dim=1)  # L2 per sample (m)
            rot_deg = angle * 180.0 / torch.pi

            test_trans_err_sum += trans_err.sum().item()
            test_rot_deg_sum += rot_deg.sum().item()
            test_count += bsz

    test_total /= len(test_loader.dataset)
    test_pos_mean = test_pos_sum / len(test_loader.dataset)
    test_ori_mean = test_ori_sum / len(test_loader.dataset)
    test_trans_mean = test_trans_err_sum / max(test_count, 1)
    test_rot_mean = test_rot_deg_sum / max(test_count, 1)

    print(
        f"[TEST] total={test_total:.6f} (pos={test_pos_mean:.6f}, ori={test_ori_mean:.6f}) "
        f"| trans_err={test_trans_mean:.6f}m rot_err={test_rot_mean:.3f}deg "
        "(SmoothL1)"
    )

    csv_file.close()
    tb_writer.close()


if __name__ == "__main__":
    main()
