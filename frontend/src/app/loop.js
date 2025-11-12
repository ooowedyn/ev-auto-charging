// render / tick 루프 관리

import * as THREE from 'three';
import { renderTriple } from '../viz/renderTriple.js';
import { renderStereo } from '../viz/renderStereo.js';
import { updateMotionState } from './stateMachine.js';

export function setupLoop({ scene, camera, renderer, controls, robot, hud, input, stereo }) {
  const clock = new THREE.Clock();
  let fps = 0;
  let lastT = performance.now();

  function tick() {
    scene.updateMatrixWorld(true);
    controls.update();

    // 조그(JOG) 제어 반영
    for (const name in input.HELD_JOG) {
        const delta = input.HELD_JOG[name] * input.JOG_STEP;
        const cur = robot.angles[name] ?? 0;
        robot.setJointAngle(name, cur + delta);
    }

    // IK 활성화 상태면 매 프레임 FK 반영
    robot.applyFK();

    const now = performance.now();
    const dt = (now - lastT) / 1000;
    lastT = now;
    fps = 0.9 * fps + 0.1 * (1 / dt);

    // 상태 업데이트 (IK + phase 전이)
    updateMotionState(scene, robot, input);

    // HUD 표시
    hud.update(robot, 'triple', `FPS: ${fps.toFixed(0)}`);

    // 렌더링 모드 전환
    if (window.VIEW_MODE === 'triple' && stereo)
      renderTriple(renderer, scene, camera, stereo.camL, stereo.camR);
    else if (window.VIEW_MODE === 'stereo' && stereo)
      renderStereo(renderer, scene, stereo.camL, stereo.camR);
    else renderer.render(scene, camera);

    requestAnimationFrame(tick);
  }

  tick();
}
