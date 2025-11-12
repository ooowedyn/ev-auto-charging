import json
import os

def merge_left_right(left_json_path, right_json_path, save_path="vision/inference/result/ellipse_centers.json"):
    # --- 파일 로드 ---
    with open(left_json_path, "r") as f:
        left_data = json.load(f)
    with open(right_json_path, "r") as f:
        right_data = json.load(f)

    left_results = left_data["results"]
    right_results = right_data["results"]

    merged = {"left": [], "right": []}

    # --- 클래스별 매칭 (cls 기준) ---
    for l_obj in left_results:
        l_cls = l_obj["cls"]
        l_cx, l_cy = l_obj["cx"], l_obj["cy"]

        # 오른쪽 JSON에서 같은 class 찾기
        matched = next((r for r in right_results if r["cls"] == l_cls), None)
        if matched is None:
            print(f"⚠️ class {l_cls} : 오른쪽 이미지에서 대응 객체 없음 → skip")
            continue

        r_cx, r_cy = matched["cx"], matched["cy"]

        merged["left"].append({"class": l_cls, "center": [l_cx, l_cy]})
        merged["right"].append({"class": l_cls, "center": [r_cx, r_cy]})

    # --- 저장 ---
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    with open(save_path, "w") as f:
        json.dump(merged, f, indent=2)
    print(f"병합 완료 → {save_path}")
    return merged


if __name__ == "__main__":
    left_json_path = "vision/Inference/image/detect_left_view/left_view_left_ellipse.json"
    right_json_path = "vision/Inference/image/detect_right_view/right_view_right_ellipse.json"
    merge_left_right(left_json_path, right_json_path)
