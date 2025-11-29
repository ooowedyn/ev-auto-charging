import * as THREE from 'three';

export function getPose(obj3d) {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  obj3d.updateWorldMatrix(true, true);
  obj3d.matrixWorld.decompose(pos, quat, scale);
  return { pos, quat, matrix: obj3d.matrixWorld.clone() };
}

export function matrixToPose(matrix) {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(pos, quat, scale);
  return {
    position: { x: pos.x, y: pos.y, z: pos.z },
    quaternion: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
  };
}

export function computeRelativePose(t_world_tcp, t_world_socket) {
  const t_tcp_socket = t_world_tcp.clone().invert().multiply(t_world_socket);
  return matrixToPose(t_tcp_socket);
}
