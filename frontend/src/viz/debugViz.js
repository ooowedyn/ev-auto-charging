import * as THREE from 'three';

export function makeDebugFrustum(cam, color = 0xffa500) {
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  cam.getWorldPosition(worldPos);
  cam.getWorldQuaternion(worldQuat);
  const near = cam.near, far = cam.far, fovRad = THREE.MathUtils.degToRad(cam.fov);
  const halfH_near = Math.tan(fovRad / 2) * near;
  const halfW_near = halfH_near * cam.aspect;
  const halfH_far = Math.tan(fovRad / 2) * far;
  const halfW_far = halfH_far * cam.aspect;

  const localCorners = [
    new THREE.Vector3(-halfW_near, halfH_near, -near),
    new THREE.Vector3(halfW_near, halfH_near, -near),
    new THREE.Vector3(halfW_near, -halfH_near, -near),
    new THREE.Vector3(-halfW_near, -halfH_near, -near),
    new THREE.Vector3(-halfW_far, halfH_far, -far),
    new THREE.Vector3(halfW_far, halfH_far, -far),
    new THREE.Vector3(halfW_far, -halfH_far, -far),
    new THREE.Vector3(-halfW_far, -halfH_far, -far),
  ];
  const worldMat = new THREE.Matrix4().compose(worldPos, worldQuat, new THREE.Vector3(1, 1, 1));
  const worldCorners = localCorners.map((p) => p.clone().applyMatrix4(worldMat));

  const pts = [];
  for (let i = 4; i < 8; i++) pts.push(worldPos.clone(), worldCorners[i].clone());
  pts.push(worldCorners[0].clone(), worldCorners[1].clone());
  pts.push(worldCorners[1].clone(), worldCorners[2].clone());
  pts.push(worldCorners[2].clone(), worldCorners[3].clone());
  pts.push(worldCorners[3].clone(), worldCorners[0].clone());
  pts.push(worldCorners[4].clone(), worldCorners[5].clone());
  pts.push(worldCorners[5].clone(), worldCorners[6].clone());
  pts.push(worldCorners[6].clone(), worldCorners[7].clone());
  pts.push(worldCorners[7].clone(), worldCorners[4].clone());

  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color,
    linewidth: 2,
    transparent: true,
    opacity: 0.9,
  });
  return new THREE.LineSegments(geom, mat);
}

export function refreshFrustums(scene, stereo, state = {}) {
  if (state.left) scene.remove(state.left);
  if (state.right) scene.remove(state.right);
  if (!stereo) return { left: null, right: null };
  const left = makeDebugFrustum(stereo.camL, 0xffa500);
  const right = makeDebugFrustum(stereo.camR, 0x00ffff);
  scene.add(left);
  scene.add(right);
  return { left, right };
}
