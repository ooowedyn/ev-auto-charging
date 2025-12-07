"""
Batch evaluation on full dataset with GT parsed from filename.
Outputs per-image CSV with GT/PRED and errors, plus summary stats and plots.

Filename format assumed:
{side}_{date}_{time}_{x}_{y}_{z}_{qx}_{qy}_{qz}_{qw}_{dist}_{visible}.png
Units: position → meters, rotation → quaternion (unit norm). Errors: meters and degrees.
"""
import argparse
import math
import time
from datetime import datetime
from pathlib import Path

import torch
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms
from PIL import Image
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from tqdm.auto import tqdm

from model.suPoseModel import PoseRegressor

# 기본값 (필요 시 여기서 수정)
DEFAULTS = {
    "data_dir": Path("/mnt/d/ev-auto-chargingfork/vision/SEGU/datasets/all"),
    "ckpt": Path("/mnt/d/ev-auto-chargingfork/vision/SEGU/checkpoints/mobienetv3_scale100_epoch30_datav2_251207_212512/best.pth"),
    "backbone": "mobilenet_v3",
    "pretrained": None,
    "run_name": "mobienetv3_scale100_epoch30_datav2_251207_212512_eval",
    "out_root": Path("/mnt/d/ev-auto-chargingfork/vision/SEGU/logs"),
    "batch_size": 32,
    "num_workers": 4,
}
# 학습 시 사용한 pos_scale (m→cm: 100). GT는 m 단위이므로 되돌려 비교.
POS_SCALE = 100.0


def measure_model_complexity(model, loader, device):
    """Estimate FLOPs, params, and FPS using a single forward pass."""
    try:
        sample_imgs, _, _ = next(iter(loader))
    except StopIteration:
        return None, None, None

    sample_imgs = sample_imgs.to(device)
    params_m = sum(p.numel() for p in model.parameters()) / 1e6

    flops_g = None
    try:
        with torch.autograd.profiler.profile(
            use_cuda=device.type == "cuda", with_flops=True, record_shapes=False
        ) as prof:
            with torch.no_grad():
                model(sample_imgs)
        flops_total = sum(e.flops for e in prof.key_averages() if e.flops is not None)
        if flops_total and flops_total > 0:
            flops_g = flops_total / 1e9
    except Exception as e:
        print(f"[WARN] FLOPs profiling failed: {e}")

    fps = None
    try:
        warmup = 3
        reps = 30
        with torch.no_grad():
            for _ in range(warmup):
                model(sample_imgs)
        if device.type == "cuda":
            torch.cuda.synchronize()
        t0 = time.perf_counter()
        with torch.no_grad():
            for _ in range(reps):
                model(sample_imgs)
        if device.type == "cuda":
            torch.cuda.synchronize()
        elapsed = max(time.perf_counter() - t0, 1e-6)
        fps = reps * sample_imgs.size(0) / elapsed
    except Exception as e:
        print(f"[WARN] FPS measurement failed: {e}")

    return flops_g, params_m, fps


def decode_coord(token: str) -> float:
    sign = -1.0 if token.startswith("m") else 1.0
    body = token[1:] if token.startswith("m") else token
    return sign * float(body.replace("d", "."))


def parse_pose_from_name(path: Path):
    name = path.name.replace(".png", "")
    parts = name.split("_")
    if len(parts) < 10:
        raise ValueError(f"Unexpected filename format: {path}")
    x, y, z, qx, qy, qz, qw = parts[3:10]
    pose = [decode_coord(x), decode_coord(y), decode_coord(z), decode_coord(qx), decode_coord(qy), decode_coord(qz), decode_coord(qw)]
    # normalize quaternion
    norm = math.sqrt(pose[3]**2 + pose[4]**2 + pose[5]**2 + pose[6]**2) + 1e-8
    pose[3] /= norm; pose[4] /= norm; pose[5] /= norm; pose[6] /= norm
    return pose


class EvalDataset(Dataset):
    def __init__(self, paths, transform):
        self.paths = list(paths)
        if not self.paths:
            raise RuntimeError("No images to evaluate.")
        self.transform = transform

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, idx):
        img_path = Path(self.paths[idx])
        img = Image.open(img_path).convert("RGB")
        if self.transform:
            img = self.transform(img)
        gt = parse_pose_from_name(img_path)
        return img, torch.tensor(gt, dtype=torch.float32), img_path.name


def get_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data_dir", type=Path, default=DEFAULTS["data_dir"], help="Folder with *.png images")
    p.add_argument("--ckpt", type=Path, default=DEFAULTS["ckpt"], help="Checkpoint path (best.pth/last.pth)")
    p.add_argument("--backbone", type=str, default=DEFAULTS["backbone"], choices=["mobilenet_v2", "mobilenet_v3"])
    p.add_argument("--pretrained", type=Path, default=DEFAULTS["pretrained"], help="Optional pretrained backbone weights")
    p.add_argument("--batch_size", type=int, default=DEFAULTS["batch_size"])
    p.add_argument("--num_workers", type=int, default=DEFAULTS["num_workers"])
    p.add_argument("--run_name", type=str, default=DEFAULTS["run_name"], help="Prefix for eval outputs")
    p.add_argument("--out_root", type=Path, default=DEFAULTS["out_root"], help="Root dir to store csv/figs")
    return p.parse_args()


def main():
    args = get_args()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    img_paths = sorted(args.data_dir.glob("*.png"))
    if not img_paths:
        raise RuntimeError(f"No images found in {args.data_dir}")

    # transforms
    norm = transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    tf = transforms.Compose([transforms.ToTensor(), norm])

    ds = EvalDataset(img_paths, transform=tf)
    loader = DataLoader(ds, batch_size=args.batch_size, shuffle=False, num_workers=args.num_workers, pin_memory=True)

    model = PoseRegressor(backbone=args.backbone, pretrained_path=str(args.pretrained) if args.pretrained else None)
    ckpt = torch.load(args.ckpt, map_location=device)
    model.load_state_dict(ckpt["model_state"])
    model.to(device).eval()

    flops_g, params_m, fps = measure_model_complexity(model, loader, device)
    if params_m is not None:
        print(f"[MODEL] Params: {params_m:.3f} M")
    if flops_g is not None:
        print(f"[MODEL] FLOPs: {flops_g:.3f} GFLOPs (per batch)")
    if fps is not None:
        print(f"[MODEL] Speed: {fps:.2f} FPS (batch_size={args.batch_size})")

    timestamp = datetime.now().strftime("%y%m%d_%H%M%S")
    run_id = f"{args.run_name}_{timestamp}"
    out_dir = Path(args.out_root) / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_csv = out_dir / f"{run_id}.csv"
    f = out_csv.open("w")
    f.write("filename,gt_x,gt_y,gt_z,gt_qx,gt_qy,gt_qz,gt_qw,pred_x,pred_y,pred_z,pred_qx,pred_qy,pred_qz,pred_qw,trans_err_m,rot_err_deg\n")

    trans_sum = 0.0
    rot_sum = 0.0
    count = 0
    gt_list = []
    pred_list = []
    trans_err_list = []
    rot_err_list = []

    with torch.no_grad():
        for imgs, gts, names in tqdm(loader, desc="Eval", leave=False):
            imgs = imgs.to(device)
            gts = gts.to(device)
            preds = model(imgs)
            preds_pos_m = preds[:, :3] / POS_SCALE
            preds_full_m = torch.cat([preds_pos_m, preds[:, 3:]], dim=1)

            trans_err = torch.norm(preds_pos_m - gts[:, :3], dim=1)  # meters
            q_pred = preds[:, 3:]
            q_gt = gts[:, 3:]
            dot = torch.sum(q_pred * q_gt, dim=1).clamp(-1.0, 1.0)
            rot_deg = torch.acos(torch.abs(dot)) * 2 * 180.0 / torch.pi

            for i in range(preds.size(0)):
                gt = gts[i].cpu().tolist()
                pr = preds_full_m[i].cpu().tolist()
                f.write(
                    f"{names[i]},"
                    f"{gt[0]:.6f},{gt[1]:.6f},{gt[2]:.6f},{gt[3]:.6f},{gt[4]:.6f},{gt[5]:.6f},{gt[6]:.6f},"
                    f"{pr[0]:.6f},{pr[1]:.6f},{pr[2]:.6f},{pr[3]:.6f},{pr[4]:.6f},{pr[5]:.6f},{pr[6]:.6f},"
                    f"{trans_err[i].item():.6f},{rot_deg[i].item():.6f}\n"
                )
                gt_list.append(gt)
                pred_list.append(pr)
                trans_err_list.append(trans_err[i].item())
                rot_err_list.append(rot_deg[i].item())

            trans_sum += trans_err.sum().item()
            rot_sum += rot_deg.sum().item()
            count += preds.size(0)

    f.close()
    trans_mean = trans_sum / max(count, 1)
    rot_mean = rot_sum / max(count, 1)
    print(f"[EVAL] images={count} | mean trans_err={trans_mean:.6f} m | mean rot_err={rot_mean:.3f} deg")
    print(f"[EVAL] saved CSV → {out_csv}")

    # 추가 통계 및 시각화
    import numpy as np
    gt_arr = np.array(gt_list)
    pred_arr = np.array(pred_list)
    trans_err_arr = np.array(trans_err_list)
    rot_err_arr = np.array(rot_err_list)

    if count > 0:
        pos_mae_cm = np.mean(np.abs(pred_arr[:, :3] - gt_arr[:, :3]), axis=0) * 100.0
        pos_rmse_cm = np.sqrt(np.mean((pred_arr[:, :3] - gt_arr[:, :3]) ** 2, axis=0)) * 100.0
        pos_med_err_cm = np.median(trans_err_arr) * 100.0
        trans_mae_cm = np.mean(trans_err_arr) * 100.0
        trans_rmse_cm = math.sqrt(np.mean(trans_err_arr ** 2)) * 100.0
        rot_mae_deg = np.mean(rot_err_arr)
        rot_med_deg = np.median(rot_err_arr)

        print(f"[EVAL] Pos MAE (cm) per axis: x={pos_mae_cm[0]:.3f}, y={pos_mae_cm[1]:.3f}, z={pos_mae_cm[2]:.3f}")
        print(f"[EVAL] Pos RMSE (cm) per axis: x={pos_rmse_cm[0]:.3f}, y={pos_rmse_cm[1]:.3f}, z={pos_rmse_cm[2]:.3f}")
        print(f"[EVAL] Pos MAE total (cm): {trans_mae_cm:.3f} | RMSE (cm): {trans_rmse_cm:.3f} | Med (cm): {pos_med_err_cm:.3f}")
        print(f"[EVAL] Rot MAE (deg): {rot_mae_deg:.3f} | Med (deg): {rot_med_deg:.3f}")

        # Scatter plots
        def scatter_save(gt_vals, pred_vals, axis_name, path):
            plt.figure()
            plt.scatter(gt_vals, pred_vals, s=6, alpha=0.4)
            plt.xlabel(f"GT {axis_name} (m)")
            plt.ylabel(f"Pred {axis_name} (m)")
            lim = [min(gt_vals.min(), pred_vals.min()), max(gt_vals.max(), pred_vals.max())]
            plt.plot(lim, lim, 'r--', linewidth=1)
            plt.title(f"{axis_name} scatter (GT vs Pred)")
            plt.tight_layout()
            plt.savefig(path)
            plt.close()

        scatter_save(gt_arr[:, 0], pred_arr[:, 0], "X", out_dir / f"{run_id}_scatter_x.png")
        scatter_save(gt_arr[:, 2], pred_arr[:, 2], "Z", out_dir / f"{run_id}_scatter_z.png")

        # Histogram of position error (cm)
        plt.figure()
        plt.hist(trans_err_arr * 100.0, bins=30, alpha=0.7, color='steelblue')
        plt.xlabel("Position error (cm)")
        plt.ylabel("Count")
        plt.title("Histogram of position error")
        plt.tight_layout()
        plt.savefig(out_dir / f"{run_id}_hist_pos_error.png")
        plt.close()

        print(f"[EVAL] Saved plots to {out_dir}")


if __name__ == "__main__":
    main()
