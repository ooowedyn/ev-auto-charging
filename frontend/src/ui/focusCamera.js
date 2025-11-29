import * as THREE from 'three';

export function updateCameraFocus(focus, { controls, camera, camMoveKeys }) {
  if (focus === 'USER') {
    controls.enabled = true;
    controls.update();
    const speed = 0.05;
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
