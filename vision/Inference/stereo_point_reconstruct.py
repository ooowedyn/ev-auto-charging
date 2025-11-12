import cv2
import numpy as np
import json
import os

def load_Q_from_yaml(calib_path):
    fs = cv2.FileStorage(calib_path, cv2.FILE_STORAGE_READ)
    Q = fs.getNode("Q").mat()
    fs.release()
    return Q


def disparity_from_depth_png(depth_png_path):
    disp = cv2.imread(depth_png_path, cv2.IMREAD_UNCHANGED)
    # normalize to float disparity (0~255 → 0~max_disp)
    disp = disp.astype(np.float32)
    disp = (disp / 255.0) * 96.0  # stereo_depth_run.py에서 numDisparities=96 기준
    return disp


def reconstruct_3d_points(centers_left, centers_right, disp_map, Q):
    points_3d = []
    for l, r in zip(centers_left, centers_right):
        xL, yL = l["center"]
        xR, yR = r["center"]

        # disparity 계산
        d = xL - xR
        if d <= 0:
            print(f"⚠️ class {l['class']} : disparity <= 0 → 스킵")
            continue

        # Q 행렬 이용한 재투영
        pts4d = cv2.perspectiveTransform(
            np.array([[[xL, yL, d]]], dtype=np.float32),
            Q
        )  # 1x1x3 → 1x1x3 (homogeneous)

        X, Y, Z = pts4d[0, 0]
        points_3d.append({"class": l["class"], "X": float(X), "Y": float(Y), "Z": float(Z)})

    return points_3d


def save_3d_points(points_3d, save_path="vision/Inference/result/points_3d.json"):
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    with open(save_path, "w") as f:
        json.dump(points_3d, f, indent=2)
    print(f"✅ 3D 포인트 저장 완료 → {save_path}")


if __name__ == "__main__":
    # ======== 경로 설정 ========
    calib_file = "vision/Inference/config/stereo_calib.yaml"
    depth_png = "vision/Inference/image/depth_map/depth_map.png"
    centers_json = "vision/Inference/result/ellipse_centers.json"
    save_path = "vision/Inference/result/points_3d.json"

    # ======== 파일 로드 ========
    Q = load_Q_from_yaml(calib_file)
    disp_map = disparity_from_depth_png(depth_png)

    with open(centers_json, "r") as f:
        centers = json.load(f)

    centers_left = centers["left"]
    centers_right = centers["right"]

    # ======== 3D 복원 ========
    points_3d = reconstruct_3d_points(centers_left, centers_right, disp_map, Q)

    # ======== 결과 저장 ========
    save_3d_points(points_3d, save_path)
