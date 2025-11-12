// 'approach→insert→done' 단계 관리

import * as THREE from 'three';

let motionPhase = 'approach';
let insertTargetPos = null;

export function updateMotionState(scene, robot, input) {
  if (!input.IK_ON || !robot.root) return;

  const plug = scene.getObjectByName('PlugFrame');
  const port = scene.getObjectByName('PortFrame');
  if (!plug || !port) return;

  // pose 계산
  const plugPos = new THREE.Vector3();
  const portPos = new THREE.Vector3();
  plug.getWorldPosition(plugPos);
  port.getWorldPosition(portPos);

  const diff = new THREE.Vector3().subVectors(portPos, plugPos);
  const dist = diff.length();

  // 상태 전이
  if (motionPhase === 'approach' && dist < 0.03) {
    motionPhase = 'insert';
    insertTargetPos = portPos.clone().addScaledVector(diff.normalize(), -0.1);
    console.log('[Phase] → insert');
  } else if (motionPhase === 'insert' && dist < 0.005) {
    motionPhase = 'done';
    console.log('[Phase] → done');
  }

  // IK 타깃 갱신
  if (robot.joints['Motor7'] && input.target) {
    if (motionPhase === 'approach') input.target.position.copy(portPos);
    if (motionPhase === 'insert' && insertTargetPos)
      input.target.position.lerp(insertTargetPos, 0.05);
  }
}
