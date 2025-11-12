# ellipse_run.py
# - original_left/right_view의 원본 이미지를 읽고
# - detect_left/right_view에 저장된 bbox JSON을 읽어서
# - (박스 5px 확장) ROI 마스크 기반 Canny → Contour → Ellipse fitting
# - 결과를 detect_*_view 폴더에 시각화 3종 + JSON으로 저장
# - 함수 리턴은 박스별 특징(타원 파라미터 + residual) 딕셔너리
# 검증 안함
import os
import json
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional, Tuple

import cv2
import numpy as np


# ------------------------------
# Dataclasses
# ------------------------------
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

# ------------------------------
# Utils
# ------------------------------
def clamp(val, lo, hi):
    return max(lo, min(hi, val))

def expand_and_clamp_box(box: List[float], margin: int, w: int, h: int) -> List[int]:
    x1, y1, x2, y2 = box
    x1 = int(clamp(x1 - margin, 0, w - 1))
    y1 = int(clamp(y1 - margin, 0, h - 1))
    x2 = int(clamp(x2 + margin, 0, w - 1))
    y2 = int(clamp(y2 + margin, 0, h - 1))
    # 혹시 잘못된 순서면 교정
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

# ------------------------------
# Core class
# ------------------------------
class EllipseFitterModule:
    def __init__(self, margin_px: int = 5, canny_low: int = 80, canny_high: int = 200):
        self.margin = margin_px
        self.canny_low = canny_low
        self.canny_high = canny_high

    def _fit_one_box(self, img_bgr, box_item, edges_all):
        """
        안정형 타원 피팅 버전
        - 히스토그램 균일화 + 감마 조정
        - 약한 외곽선도 포함하는 Canny
        - 내부 노이즈 제거용 중앙 클리핑
        """
        h, w = img_bgr.shape[:2]
        bx = expand_and_clamp_box(box_item.bbox, self.margin, w, h)
        x1, y1, x2, y2 = bx

        # --- ROI 추출 ---
        roi = img_bgr[y1:y2, x1:x2]
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)

        # === 1️⃣ 명암 대비 보정 ===
        gray_eq = cv2.equalizeHist(gray)

        # 감마 보정 (외곽부 대비 상승)
        gamma = 0.9
        gray_gamma = np.power(gray_eq / 255.0, 1 / gamma)
        gray_gamma = np.uint8(gray_gamma * 255)

        # === 2️⃣ 엣지 검출 (Canny 감도 상승) ===
        blur = cv2.GaussianBlur(gray_gamma, (3, 3), 0)
        edges = cv2.Canny(blur, 10, 60)  # 감도 ↑

        # === 3️⃣ 내부 노이즈 제거 (ROI 중심 마스크 블록) ===
        mask = np.ones_like(edges, dtype=np.uint8) * 255
        h_r, w_r = edges.shape
        cx, cy = w_r // 2, h_r // 2
        inner_w, inner_h = int(w_r * 0.15), int(h_r * 0.15)
        mask[cy - inner_h:cy + inner_h, cx - inner_w:cx + inner_w] = 0
        edges = cv2.bitwise_and(edges, edges, mask=mask)

        # === 4️⃣ 모폴로지 닫기 (끊긴 외곽선 연결) ===
        kernel = np.ones((5, 5), np.uint8)
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

        # === 5️⃣ 컨투어 탐색 ===
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if len(contours) == 0:
            return None

        roi_area = (x2 - x1) * (y2 - y1)
        large_contours = [c for c in contours if cv2.contourArea(c) > 0.15 * roi_area]
        cnt = max(large_contours or contours, key=cv2.contourArea)

        if len(cnt) < 5:
            return None

        # --- 타원 피팅 (ROI → 전역 좌표 변환) ---
        ellipse = cv2.fitEllipse(cnt)
        (cx_e, cy_e), (major, minor), angle_deg = ellipse
        cx_e += x1
        cy_e += y1

        # --- residual 계산 ---
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

    def process_one_side(
        self,
        side_name: str,                        # "left" / "right"
        original_img_path: str,               # 원본 이미지 경로
        detect_dir: str,                      # bbox JSON 및 출력 저장 폴더 (detect_*_view)
        bbox_json_path: str                   # 해당 사이드의 bbox JSON 경로
    ) -> Dict[str, Any]:
        """
        반환:
        {
          "side": "left",
          "image": "path/to/original.png",
          "results": [ EllipseResult... ],
          "outputs": {
             "mask_image": "...",
             "edges_image": "...",
             "ellipse_image": "...",
             "ellipse_json": "..."
          }
        }
        """
        os.makedirs(detect_dir, exist_ok=True)

        # 파일 이름 베이스 (고유 저장용)
        base = os.path.splitext(os.path.basename(original_img_path))[0]

        tag = f"{base}_{side_name}"

        # 1) 이미지/박스 로드
        img = cv2.imread(original_img_path, cv2.IMREAD_COLOR)
        if img is None:
            raise FileNotFoundError(f"원본 이미지가 없습니다: {original_img_path}")
        h, w = img.shape[:2]

        boxes = load_bbox_json(bbox_json_path)  # 0~N개 (최대 3개 기대)
        # 2) 공통 Canny (원본 전체)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        edges_all = cv2.Canny(gray, self.canny_low, self.canny_high)

        # 3) 전체 ROI 마스크/엣지 합성용 초기화
        union_mask = np.zeros((h, w), dtype=np.uint8)
        union_edges = np.zeros((h, w), dtype=np.uint8)

        # 4) 박스별 처리
        results: List[EllipseResult] = []
        for b in boxes:
            # 박스 확장/마스크
            bx = expand_and_clamp_box(b.bbox, self.margin, w, h)
            x1, y1, x2, y2 = bx
            union_mask[y1:y2, x1:x2] = 255

            # 박스 반영된 엣지
            edges_roi = cv2.bitwise_and(edges_all, edges_all, mask=union_mask)
            # 개별 피팅 (개별 ROI만 사용해서 다시 계산해야 하므로 별도 호출)
            res = self._fit_one_box(img, b, edges_all)
            if res is not None:
                results.append(res)

            # union_edges는 누적(시각화용)
            union_edges = cv2.bitwise_or(union_edges, edges_roi)

        # 5) 시각화 3종 생성
        # (1) 마스크 시각화
        mask_vis = union_mask.copy()

        # (2) 엣지 시각화
        edges_vis = cv2.cvtColor(union_edges, cv2.COLOR_GRAY2BGR)

        # (3) 타원 시각화: 원본 위에 bbox/ellipse 그리기
        ell_vis = img.copy()
        color_map = {
            0: (0, 255, 0),
            1: (255, 215, 0),
            2: (255, 0, 0),
            3: (0, 165, 255),
        }
        for r in results:
            c = color_map.get(r.cls, (255, 255, 255))
            # bbox
            x1, y1, x2, y2 = r.bbox
            cv2.rectangle(ell_vis, (x1, y1), (x2, y2), c, 2)
            # ellipse
            ellipse = ((r.cx, r.cy), (r.major, r.minor), r.angle_deg)
            cv2.ellipse(ell_vis, ellipse, c, 2)
            # 라벨
            cv2.putText(
                ell_vis,
                f"cls:{r.cls} conf:{r.confidence:.2f} res:{r.residual:.1f}",
                (x1, max(0, y1 - 6)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                c,
                2,
                cv2.LINE_AA
            )

        # 6) 저장 경로
        out_mask_path = os.path.join(detect_dir, f"{tag}_mask_all.png")
        out_edges_path = os.path.join(detect_dir, f"{tag}_edges_all.png")
        out_ellipse_path = os.path.join(detect_dir, f"{tag}_ellipse_all.png")
        out_json_path = os.path.join(detect_dir, f"{tag}_ellipse.json")

        cv2.imwrite(out_mask_path, mask_vis)
        cv2.imwrite(out_edges_path, edges_vis)
        cv2.imwrite(out_ellipse_path, ell_vis)

        # 7) 결과 JSON 저장
        json_payload = {
            "side": side_name,
            "image": original_img_path,
            "results": [asdict(r) for r in results]
        }
        with open(out_json_path, "w", encoding="utf-8") as f:
            json.dump(json_payload, f, indent=2)

        print(f"[INFO] ✅ {side_name} 저장 완료")
        print(f"  - mask:   {out_mask_path}")
        print(f"  - edges:  {out_edges_path}")
        print(f"  - ellipse:{out_ellipse_path}")
        print(f"  - json:   {out_json_path}")

        return {
            "side": side_name,
            "image": original_img_path,
            "results": [asdict(r) for r in results],
            "outputs": {
                "mask_image": out_mask_path,
                "edges_image": out_edges_path,
                "ellipse_image": out_ellipse_path,
                "ellipse_json": out_json_path
            }
        }


# ------------------------------
# Main
# ------------------------------
if __name__ == "__main__":
    LEFT_ORI  = "vision/Inference/image/original_left_view/left_view.png"
    RIGHT_ORI = "vision/Inference/image/original_right_view/right_view.png"
    LEFT_DET_DIR  = "vision/Inference/image/detect_left_view"
    RIGHT_DET_DIR = "vision/Inference/image/detect_right_view"
    LEFT_BBOX_JSON  = os.path.join(LEFT_DET_DIR,  "left_view_bbox.json")
    RIGHT_BBOX_JSON = os.path.join(RIGHT_DET_DIR, "right_view_bbox.json")

    fitter = EllipseFitterModule(margin_px=5, canny_low=80, canny_high=200)

    left_pack  = fitter.process_one_side("left",  LEFT_ORI,  LEFT_DET_DIR,  LEFT_BBOX_JSON)
    right_pack = fitter.process_one_side("right", RIGHT_ORI, RIGHT_DET_DIR, RIGHT_BBOX_JSON)

    # 필요 시 여기서 left/right 결과를 합쳐 반환/저장하거나 다음 단계(스테레오 매칭)로 넘기세요.
