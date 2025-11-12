import json
import subprocess
import cv2
import numpy as np
import os
import sys

def generate_stereo_yaml_from_json(json_path, calib_path):
    with open(json_path, "r") as f:
        params = json.load(f)

    # 파라미터 읽기
    width = params["width"]
    height = params["height"]
    fov = params["fov"]
    baseline = params["baseline"]
    fx = params["intrinsics"]["fx"]
    fy = params["intrinsics"]["fy"]
    cx = params["intrinsics"]["cx"]
    cy = params["intrinsics"]["cy"]

    # OpenCV calibration matrix 구성
    K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], dtype=np.float32)
    D = np.zeros((1, 5), dtype=np.float32)
    R = np.eye(3, dtype=np.float32)
    T = np.array([[-baseline, 0, 0]], dtype=np.float32)
    Q = np.array(
        [
            [1, 0, 0, -cx],
            [0, 1, 0, -cy],
            [0, 0, 0, fx],
            [0, 0, -1.0 / baseline, 0],
        ],
        dtype=np.float32,
    )

    os.makedirs(os.path.dirname(calib_path), exist_ok=True)
    fs = cv2.FileStorage(calib_path, cv2.FILE_STORAGE_WRITE)
    fs.write("K1", K)
    fs.write("D1", D)
    fs.write("K2", K)
    fs.write("D2", D)
    fs.write("R", R)
    fs.write("T", T)
    fs.write("Q", Q)
    fs.release()

    print(f"✅ Calibration file generated from {json_path} → {calib_path}")
    print(f"  fx={fx:.2f}, fy={fy:.2f}, cx={cx:.2f}, cy={cy:.2f}, baseline={baseline*1000:.1f}mm")





def compute_depth_map(left_img_path, right_img_path, calib_file):
    fs = cv2.FileStorage(calib_file, cv2.FILE_STORAGE_READ)
    K1 = fs.getNode("K1").mat()
    D1 = fs.getNode("D1").mat()
    K2 = fs.getNode("K2").mat()
    D2 = fs.getNode("D2").mat()
    R = fs.getNode("R").mat()
    T = fs.getNode("T").mat()
    Q = fs.getNode("Q").mat()
    fs.release()

    # 🔹 T 형상 수정
    if T.shape == (1, 3):
        T = T.T

    imgL = cv2.imread(left_img_path)
    imgR = cv2.imread(right_img_path)
    if imgL is None or imgR is None:
        print("❌ 이미지 경로 확인 필요.")
        sys.exit(1)

    h, w = imgL.shape[:2]
    R1, R2, P1, P2, Q, _, _ = cv2.stereoRectify(K1, D1, K2, D2, (w, h), R, T, alpha=0)
    mapLx, mapLy = cv2.initUndistortRectifyMap(K1, D1, R1, P1, (w, h), cv2.CV_32FC1)
    mapRx, mapRy = cv2.initUndistortRectifyMap(K2, D2, R2, P2, (w, h), cv2.CV_32FC1)
    rectL = cv2.remap(imgL, mapLx, mapLy, cv2.INTER_LINEAR)
    rectR = cv2.remap(imgR, mapRx, mapRy, cv2.INTER_LINEAR)

    matcher = cv2.StereoSGBM_create(
        minDisparity=0,
        numDisparities=96,
        blockSize=5,
        P1=8 * 3 * 5**2,
        P2=32 * 3 * 5**2,
        uniquenessRatio=10,
        speckleWindowSize=50,
        speckleRange=2,
        preFilterCap=63,
        mode=cv2.STEREO_SGBM_MODE_SGBM_3WAY,
    )

    disp = matcher.compute(rectL, rectR).astype(np.float32) / 16.0
    points_3D = cv2.reprojectImageTo3D(disp, Q)
    depth_map = points_3D[:, :, 2]

    disp_vis = cv2.normalize(disp, None, 0, 255, cv2.NORM_MINMAX)
    disp_vis = np.uint8(disp_vis)
    cv2.imwrite("vision/Inference/image/depth_map/depth_map.png", disp_vis)
    print("✅ depth_map.png saved")

    return disp, depth_map, points_3D


if __name__ == "__main__":
    json_file = "vision/Inference/config/stereo_params.json"
    calib_file = "vision/Inference/config/stereo_calib.yaml"
    left_img = "vision/Inference/image/original_left_view/left_view.png"
    right_img = "vision/Inference/image/original_right_view/right_view.png"

    # ① JS에서 YAML 자동 생성
    if not os.path.exists(calib_file):
        generate_stereo_yaml_from_json(json_file, calib_file)

    # ② Depth map 계산
    disp, depth, pts3d = compute_depth_map(left_img, right_img, calib_file)

    print("Depth map shape:", depth.shape)
    print("Sample depth value:", depth[depth.shape[0] // 2, depth.shape[1] // 2])