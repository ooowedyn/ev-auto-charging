import * as THREE from 'three';

export function updateCameraFocus(focus, { controls, camera, camMoveKeys, selfRotate = false }) {
  if (focus === 'USER') {
    // 자전 모드에서는 OrbitControls를 끄고 카메라 이동만 직접 처리
    controls.enabled = !selfRotate;
    if (!selfRotate) controls.update();
    const speed = 0.01; // move finer when controlling main camera
    const dirVec = new THREE.Vector3();
    const moveCam = (v, s) => {
      camera.position.addScaledVector(v, s);
      controls.target.addScaledVector(v, s);
    };
    if (camMoveKeys['KeyW']) {
      camera.getWorldDirection(dirVec);
      moveCam(dirVec, speed);
    }
    if (camMoveKeys['KeyS']) {
      camera.getWorldDirection(dirVec);
      moveCam(dirVec, -speed);
    }
    if (camMoveKeys['KeyA']) {
      camera.getWorldDirection(dirVec);
      dirVec.crossVectors(camera.up, dirVec).normalize();
      moveCam(dirVec, speed);
    }
    if (camMoveKeys['KeyD']) {
      camera.getWorldDirection(dirVec);
      dirVec.crossVectors(camera.up, dirVec).normalize();
      moveCam(dirVec, -speed);
    }
    if (camMoveKeys['KeyQ']) moveCam(new THREE.Vector3(0, -1, 0), speed);
    if (camMoveKeys['KeyE']) moveCam(new THREE.Vector3(0, 1, 0), speed);
  } else {
    controls.enabled = false;
  }
}
