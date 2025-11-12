// 메인 엔트리 (기존 main.js 역할 정리)

import { setupScene } from './setupScene.js';
import { setupLoop } from './loop.js';
import { HUD } from '../ui/hud.js';
import { InputController } from '../ui/inputController.js';

export async function bootstrapApp() {
  const {
    scene, camera, renderer, controls, dir,
    robot, stereo, plugFrame, portFrame, ikTarget,
  } = await setupScene();

  const hud = new HUD();
  const input = new InputController(robot, ikTarget);

  // 필요 시 전역에서 보기 쉽게
  window.VIEW_MODE = 'triple';

  setupLoop({ scene, camera, renderer, controls, robot, hud, input, stereo });

  console.log('✅ App initialized');
}