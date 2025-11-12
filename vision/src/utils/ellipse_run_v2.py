# ellipse_run_v2.py
# - original_left/right_view의 원본 이미지를 읽고
# - detect_left/right_view에 저장된 bbox JSON을 읽어서
# - (박스 margin 확장) ROI 기반 Canny → Contour → Ellipse fitting (8개 핀)
# - 결과를 detect_*_view 폴더에 시각화 + JSON으로 저장
# - (선택) CAD 기준점 JSON + K,dist가 있으면 solvePnP로 6D Pose 계산
# - 작성: 2025-11-08

import os
import json
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional, Tuple

import cv2
import numpy as np


# ==============================
# 설정 / 매핑
# ==============================
# YOLO class id → CCS Type-1 핀 이름
PIN_MAP = {
    0: "center",
    1: "L2",
    2: "L1",
    3: "CP",
    4: "CS",
    5: "PE",
    6: "DC-",
    7: "DC+"
}

# solvePnP 입력 순서(고정)
PIN_ORDER = ["center", "L2", "L1", "CP", "CS", "PE", "DC-", "DC+"]

# (옵션) CAD 기준점 JSON이 없을 때 사용할 Fallback (단위: cm, center가 원점)
FALLBACK_OBJ_POINTS_CM = {
    "center": [0.0000, 0.0000, 0.0000],
    "L2":     [-0.7850, 0.6800, 0.0000],
    "L1":     [ 0.7850, 0.6800, 0.0000],
    "CP":     [-1.0650,-0.5600, 0.0000],
    "CS":     [ 1.0650,-0.5600, 0.0000],
    "PE":     [ 0.0000,-1.0800, 0.0000],
    "DC-":    [-1.3000,-4.2000, 0.0000],
    "DC+":    [ 1.3000,-4.2000, 0.0000]
}


# ==============================
# Dataclasses
# ==============================
@dataclass
class BoxItem:
    bbox: List[float]          # [x1,y1,x2,y2]
    confidence: float
    cls: int

@dataclass
class EllipseResult:
    cls: int
    confidence: float
    bbox: List[int]            # 확장/클램프 적용된 정수 bbox
    cx: float
    cy: float
    major: float
    minor: float
    angle_deg: float
    residual: float            # (ellipse mask vs edges) 평균 차이


# ==============================
# Utils
# ==============================
def clamp(val, lo, hi):
    return max(lo, min(hi, val))

def expand_and_clamp_box(box: List[float], margin: int, w: int, h: int) -> List[int]:
    x1, y1, x2, y2 = box
    x1 = int(clamp(x1 - margin, 0, w - 1))
    y1 = int(clamp(y1 - margin, 0, h - 1))
    x2 = int(clamp(x2 + margin, 0, w - 1))
    y2 = int(clamp(y2 + margin, 0, h - 1))
    if x2 <= x1: x2 = min(w - 1, x1 + 1)
    if y2 <= y1: y2 = min(h - 1, y1 + 1)
    return [x1, y1, x2, y2]

def load_bbox_json(json_path: str) -> List[BoxItem]:
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    items = []
    for d in data:
        items.append(
            BoxItem(
                bbox=d["bbox"],
                confidence=float(d.get("confidence", 0.0)),
                cls=int(d.get("class", -1)),
            )
        )
    return items

def ensure_dir(path: str):
    os.makedirs(path, exist_ok=True)

def draw_ellipse_on(img, res: EllipseResult, color=(0,255,0)):
    ellipse = ((res.cx, res.cy), (res.major, res.minor), res.angle_deg)
    cv2.ellipse(img, ellipse, color, 2)
    cv2.circle(img, (int(res.cx), int(res.cy)), 2, (255,255,255), -1)

def to_objpts_from_json(json_path: Optional[str]) -> np.ndarray:
    """
    CAD 기준점 JSON을 읽어 (PIN_ORDER 순서로) m 단위 numpy 반환.
    JSON 스키마:
    {
      "unit":"cm" or "m",
      "points":{ "center":[x,y,z], "L2":[x,y,z], ... }
    }
    """
    if json_path and os.path.isfile(json_path):
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        unit = (data.get("unit") or "").lower()
        pts = data["points"]
        arr = np.array([pts[name] for name in PIN_ORDER], dtype=np.float64)
        if unit in ("cm", "centimeter", "centimeters"):
            arr = arr * 0.01
        elif unit in ("mm", "millimeter", "millimeters"):
            arr = arr * 0.001
        # unit == "m"면 그대로
        return arr
    else:
        # Fallback: cm → m
        arr_cm = np.array([FALLBACK_OBJ_POINTS_CM[name] for name in PIN_ORDER], dtype=np.float64)
        return arr_cm * 0.01


# ==============================
# Core class
# ==============================
class EllipseFitterModule:
    def __init__(self,
                 margin_px: int = 5,
                 canny_low: int = 80,
                 canny_high: int = 200):
        self.margin = margin_px
        self.canny_low = canny_low
        self.canny_high = canny_high

    def _fit_one_box(self, img_bgr, box_item, edges_all):
        h, w = img_bgr.shape[:2]
        bx = expand_and_clamp_box(box_item.bbox, self.margin, w, h)
        x1, y1, x2, y2 = bx
        roi = img_bgr[y1:y2, x1:x2]
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)

        blur = cv2.GaussianBlur(gray, (3,3), 0)
        edges = cv2.Canny(blur, 10, 60)
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        # ✅ class 0이면 여러 타원 리턴
        if box_item.cls == 0:
            ellipses = []
            for cnt in contours:
                if len(cnt) < 5:
                    continue
                ellipse = cv2.fitEllipse(cnt)
                (cx_e, cy_e), (major, minor), angle_deg = ellipse
                cx_e += x1
                cy_e += y1

                ell_mask = np.zeros((h, w), dtype=np.uint8)
                cv2.ellipse(ell_mask, ((cx_e, cy_e), (major, minor), angle_deg), 255, 1)
                diff = cv2.absdiff(ell_mask, edges_all)
                residual = float(np.mean(diff[y1:y2, x1:x2]))

                ellipses.append(EllipseResult(
                    cls=box_item.cls,
                    confidence=box_item.confidence,
                    bbox=bx,
                    cx=float(cx_e),
                    cy=float(cy_e),
                    major=float(major),
                    minor=float(minor),
                    angle_deg=float(angle_deg),
                    residual=residual
                ))
            return ellipses  # ✅ 여러 개 리턴

        # ✅ class 0 이외는 기존 1개짜리 로직 그대로
        if len(contours) == 0:
            return None
        cnt = max(contours, key=cv2.contourArea)
        if len(cnt) < 5:
            return None
        ellipse = cv2.fitEllipse(cnt)
        (cx_e, cy_e), (major, minor), angle_deg = ellipse
        cx_e += x1
        cy_e += y1
        ell_mask = np.zeros((h, w), dtype=np.uint8)
        cv2.ellipse(ell_mask, ((cx_e, cy_e), (major, minor), angle_deg), 255, 1)
        diff = cv2.absdiff(ell_mask, edges_all)
        residual = float(np.mean(diff[y1:y2, x1:x2]))

        return EllipseResult(
            cls=box_item.cls,
            confidence=box_item.confidence,
            bbox=bx,
            cx=float(cx_e),
            cy=float(cy_e),
            major=float(major),
            minor=float(minor),
            angle_deg=float(angle_deg),
            residual=residual
        )

    def process_one_side(self,
                         side_name: str,                 # "left" / "right"
                         original_img_path: str,         # 원본 이미지
                         detect_dir: str,                # 결과 저장 폴더
                         bbox_json_path: str             # YOLO bbox JSON
                         ) -> Dict[str, Any]:
        """
        반환 JSON:
        {
          "side": "left",
          "image": ".../left_view.png",
          "points": {
              "center": {"cx":..,"cy":..,"major":..,"minor":..,"angle_deg":..,"residual":..,"cls":0,"confidence":..,"bbox":[...]},
              "L1": {...}, ...
          },
          "outputs": { "ellipse_image": ".../xxx_ellipse_all.png", "ellipse_json": ".../xxx_ellipse.json" }
        }
        """
        ensure_dir(detect_dir)

        base = os.path.splitext(os.path.basename(original_img_path))[0]
        tag = f"{base}_{side_name}"

        img = cv2.imread(original_img_path, cv2.IMREAD_COLOR)
        if img is None:
            raise FileNotFoundError(f"원본 이미지가 없습니다: {original_img_path}")
        h, w = img.shape[:2]

        boxes = load_bbox_json(bbox_json_path)

        # 전역 edges (residual 계산용)
        edges_all = cv2.Canny(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), self.canny_low, self.canny_high)

        # 결과 수집
        results_by_pin: Dict[str, Dict[str, Any]] = {}
        vis = img.copy()

        for b in boxes:
            if b.cls == 0:
                # 큰 원(class 0): 내부 6개 타원 검출
                multi_res = self._fit_one_box(img, b, edges_all)
                if not multi_res:
                    continue

                # 중심좌표 기반 자동 정렬
                pts = np.array([[r.cx, r.cy] for r in multi_res])
                # y기준 정렬 (위쪽 3, 아래쪽 3)
                pts_sorted = sorted(multi_res, key=lambda r: r.cy)
                top3 = sorted(pts_sorted[:3], key=lambda r: r.cx)
                bottom3 = sorted(pts_sorted[3:], key=lambda r: r.cx)
                name_order = ["L2", "center", "L1", "CP", "PE", "CS"]
                ordered = top3 + bottom3

                for name, r in zip(name_order, ordered):
                    results_by_pin[name] = asdict(r)

            else:
                # class1,2: DC-, DC+ 그대로
                res = self._fit_one_box(img, b, edges_all)
                if res:
                    pin_name = PIN_MAP.get(res.cls, f"cls_{res.cls}")
                    results_by_pin[pin_name] = asdict(res)


        # 시각화
        color_map = {
            "center": (0, 255, 0),
            "L1": (0, 255, 255),
            "L2": (255, 255, 0),
            "CP": (255, 0, 255),
            "CS": (255, 128, 0),
            "PE": (0, 165, 255),
            "DC-": (255, 0, 0),
            "DC+": (0, 128, 255),
        }
        for name, rdict in results_by_pin.items():
            r = EllipseResult(**{k: rdict[k] for k in ["cls","confidence","bbox","cx","cy","major","minor","angle_deg","residual"]})
            draw_ellipse_on(vis, r, color=color_map.get(name, (200,200,200)))
            cv2.putText(vis, name, (int(r.cx)+5, int(r.cy)-5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color_map.get(name, (200,200,200)), 2, cv2.LINE_AA)

        # 저장
        out_ellipse_img = os.path.join(detect_dir, f"{tag}_ellipse_all.png")
        out_ellipse_json = os.path.join(detect_dir, f"{tag}_ellipse.json")
        cv2.imwrite(out_ellipse_img, vis)

        payload = {
            "side": side_name,
            "image": original_img_path,
            "points": results_by_pin
        }
        with open(out_ellipse_json, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

        print(f"[INFO] ✅ {side_name} 완료: {len(results_by_pin)} points")
        print(f"  - ellipse vis : {out_ellipse_img}")
        print(f"  - ellipse json: {out_ellipse_json}")

        return {
            **payload,
            "outputs": {
                "ellipse_image": out_ellipse_img,
                "ellipse_json": out_ellipse_json
            }
        }


# ==============================
# PnP / Pose 유틸
# ==============================
def collect_img_points_for_pnp(ellipse_json_path: str) -> Optional[np.ndarray]:
    """
    ellipse JSON에서 PIN_ORDER 순서대로 (u,v) 픽셀 좌표 배열 반환
    모든 핀이 있어야 PnP에 안정적입니다(최소 4점 필요).
    """
    if not os.path.isfile(ellipse_json_path):
        return None
    with open(ellipse_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    pts = []
    for name in PIN_ORDER:
        if name not in data["points"]:
            return None
        entry = data["points"][name]
        pts.append([entry["cx"], entry["cy"]])
    return np.array(pts, dtype=np.float64)

def solve_pnp_from_files(ellipse_json_path: str,
                         obj_points_json_path: Optional[str],
                         K: np.ndarray,
                         dist: np.ndarray,
                         method: str = "IPPE") -> Optional[Dict[str, Any]]:
    """
    ellipse JSON + CAD 기준점 JSON + K,dist로 PnP 수행.
    method: "IPPE" | "ITERATIVE" | "AP3P" | "RANSAC"
    """
    img_pts = collect_img_points_for_pnp(ellipse_json_path)
    if img_pts is None:
        print("[WARN] PnP 실패: 필요한 핀 좌표가 충분치 않습니다.")
        return None

    obj_pts_m = to_objpts_from_json(obj_points_json_path)

    flag = cv2.SOLVEPNP_IPPE if method.upper() == "IPPE" else \
           cv2.SOLVEPNP_ITERATIVE if method.upper() == "ITERATIVE" else \
           cv2.SOLVEPNP_AP3P if method.upper() == "AP3P" else \
           cv2.SOLVEPNP_IPPE

    success, rvec, tvec = cv2.solvePnP(obj_pts_m, img_pts, K, dist, flags=flag)
    if not success and method.upper() != "RANSAC":
        # 보조: RANSAC 시도
        success, rvec, tvec, inliers = cv2.solvePnPRansac(
            obj_pts_m, img_pts, K, dist,
            iterationsCount=1000, reprojectionError=2.0,
            flags=cv2.SOLVEPNP_AP3P
        )

    if not success:
        print("[WARN] solvePnP 실패")
        return None

    R, _ = cv2.Rodrigues(rvec)

    # 오일러(roll-pitch-yaw; ZYX 기준) 계산
    def rot2euler_zyx(Rm: np.ndarray) -> Tuple[float,float,float]:
        sy = np.sqrt(Rm[0,0]**2 + Rm[1,0]**2)
        yaw   = np.arctan2(Rm[1,0], Rm[0,0])
        pitch = np.arctan2(-Rm[2,0], sy)
        roll  = np.arctan2(Rm[2,1], Rm[2,2])
        return roll, pitch, yaw

    roll, pitch, yaw = rot2euler_zyx(R)
    x, y, z = tvec.flatten()
    # 재투영 오차
    proj, _ = cv2.projectPoints(obj_pts_m, rvec, tvec, K, dist)
    reproj_err = np.linalg.norm(proj.reshape(-1,2) - img_pts, axis=1).mean()

    return {
        "rvec": rvec.flatten().tolist(),
        "tvec": tvec.flatten().tolist(),
        "R": R.tolist(),
        "roll_deg": float(np.degrees(roll)),
        "pitch_deg": float(np.degrees(pitch)),
        "yaw_deg": float(np.degrees(yaw)),
        "reprojection_error_px": float(reproj_err)
    }


# ==============================
# Main
# ==============================
if __name__ == "__main__":
    # ---- 경로 설정 (필요에 맞게 수정) ----
    LEFT_ORI   = "vision/Inference/image/original_left_view/left_view.png"
    RIGHT_ORI  = "vision/Inference/image/original_right_view/right_view.png"

    LEFT_DIR   = "vision/Inference/image/detect_left_view"
    RIGHT_DIR  = "vision/Inference/image/detect_right_view"

    LEFT_BBOX  = os.path.join(LEFT_DIR,  "left_view_bbox.json")
    RIGHT_BBOX = os.path.join(RIGHT_DIR, "right_view_bbox.json")

    # (선택) CAD 기준점 JSON 경로 (없으면 내부 Fallback 사용)
    OBJPOINTS_JSON = "ccs_type1_reference.json"  # 없으면 자동 Fallback

    # (선택) 카메라 내참수 (예시값 → 실제 보정 값으로 교체)
    # fx, fy, cx, cy는 사용자 환경에 맞게 입력
    fx, fy, cx, cy = 1350.0, 1350.0, 960.0, 540.0
    K = np.array([[fx, 0, cx],
                  [0, fy, cy],
                  [0,  0,  1]], dtype=np.float64)
    # 왜곡계수(예시는 0)
    dist = np.zeros(5, dtype=np.float64)

    fitter = EllipseFitterModule(margin_px=5, canny_low=80, canny_high=200)

    # 좌/우 처리
    left_pack  = fitter.process_one_side("left",  LEFT_ORI,  LEFT_DIR,  LEFT_BBOX)
    right_pack = fitter.process_one_side("right", RIGHT_ORI, RIGHT_DIR, RIGHT_BBOX)

    # (선택) PnP 계산: 좌/우 모두 시도
    left_ellipse_json  = left_pack["outputs"]["ellipse_json"]
    right_ellipse_json = right_pack["outputs"]["ellipse_json"]

    print("\n[INFO] ---- solvePnP (LEFT) ----")
    left_pose = solve_pnp_from_files(left_ellipse_json, OBJPOINTS_JSON, K, dist, method="IPPE")
    if left_pose:
        print(json.dumps(left_pose, indent=2))

    print("\n[INFO] ---- solvePnP (RIGHT) ----")
    right_pose = solve_pnp_from_files(right_ellipse_json, OBJPOINTS_JSON, K, dist, method="IPPE")
    if right_pose:
        print(json.dumps(right_pose, indent=2))

    # 이후: 스테레오 정렬/삼각측량 또는 로봇 베이스 좌표계 변환은
    # T_base_cam과 조합하여 별도 모듈에서 수행하세요.
