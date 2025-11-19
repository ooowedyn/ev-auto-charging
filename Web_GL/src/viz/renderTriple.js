/*
renderTriple: Global + L/R 3-way Rendering
------------------------------------------------------------
역할:
  - 좌측: 전역 카메라(상황 판단), 우칙 상/하: L/R 스테레오
  - 멀티뷰 동시 렌더 및 깊이 간섭 방지 처리

주요 Export:
  - function renderTriple(renderer, scene, camGlobal, camL, CamR)

자주 수정하는 지점:
  - 좌/우 폭(예:좌 60%), 상/하 분할 비율
  - 어떤 카메라를 전역뷰로 쓸지
*/
export function renderTriple(renderer, scene, camGlobal, camL, camR) {
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  renderer.setClearColor(0x111318, 1);
  renderer.clear(true, true, true);
  const W = renderer.domElement.clientWidth,
    H = renderer.domElement.clientHeight;
  const leftW = Math.floor(W * 0.6),
    rightW = W - leftW,
    halfH = Math.floor(H / 2);

  // Global
  renderer.setViewport(0, 0, leftW, H);
  renderer.setScissor(0, 0, leftW, H);
  renderer.clearDepth();
  renderer.render(scene, camGlobal);

  // Right-top: L
  renderer.setViewport(leftW, halfH, rightW, H - halfH);
  renderer.setScissor(leftW, halfH, rightW, H - halfH);
  renderer.clearDepth();
  renderer.render(scene, camL);

  // Right-bottom: R
  renderer.setViewport(leftW, 0, rightW, halfH);
  renderer.setScissor(leftW, 0, rightW, halfH);
  renderer.clearDepth();
  renderer.render(scene, camR);

  renderer.setScissorTest(false);
  renderer.autoClear = true;
}
