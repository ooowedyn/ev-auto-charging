/*
renderStereo: Side-by-side L/R Rendering
------------------------------------------------------------
역할:
  - 좌/우 스테레오 카메라를 한 프레임이에 2분할로 렌더
  - autoClear=false, setScissorTest, clearDepth()로 깊이 간섭 방지

주요 Export:
  - function renderStereo(renderer, scene, camL, camR)

자주 수정하는 지점:
  - 좌/우 뷰포트 비율/레이아웃
*/
export function renderStereo(renderer, scene, camL, camR) {
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  renderer.setClearColor(0x111318, 1);
  renderer.clear(true, true, true);
  const W = renderer.domElement.clientWidth,
    H = renderer.domElement.clientHeight,
    HW = Math.floor(W / 2);

  renderer.setViewport(0, 0, HW, H);
  renderer.setScissor(0, 0, HW, H);
  renderer.clearDepth();
  renderer.render(scene, camL);

  renderer.setViewport(HW, 0, W - HW, H);
  renderer.setScissor(HW, 0, W - HW, H);
  renderer.clearDepth();
  renderer.render(scene, camR);

  renderer.setScissorTest(false);
  renderer.autoClear = true;
}
