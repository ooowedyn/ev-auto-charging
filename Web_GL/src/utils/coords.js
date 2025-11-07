/*
Coordinate & Intrinsics Utilities
-----------------------------------------
역할: 
  - three.js(−Z forward, Y up) ↔ CV(+Z forward, Y down) 변환 행렬 예시 제공
  - 카메라 내부 파라미터(K: fx, fy, cx, cy) 추출 헬퍼
주요 Export:
  - T_THREE_TO_CV, intrinsicsFromCam(cam)

주요 수정하는 지점:
  - 좌표계 컨벤션(필요 시 별도 변환 행렬 도입)
  - intrinsics 계산식(프로젝션/뷰포트에 맞게 조율)
*/

import * as THREE from 'three';

// three(-Z forward, Y up) → cv(+Z forward, Y down) 예시 변환
export const T_THREE_TO_CV = new THREE.Matrix4()
  .makeRotationY(Math.PI)
  .multiply(new THREE.Matrix4().makeRotationX(Math.PI));

export function intrinsicsFromCam(cam) {
  const f = (0.5 * cam.getFilmHeight()) / Math.tan(THREE.MathUtils.degToRad(0.5 * cam.fov));
  const fy = f,
    fx = f * cam.aspect;
  const cx = cam.viewport ? cam.viewport.z / 2 : 0.5;
  const cy = cam.viewport ? cam.viewport.w / 2 : 0.5;
  return { fx, fy, cx, cy };
}
