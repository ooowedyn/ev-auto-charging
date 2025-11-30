import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * 차량(GLB) 로드/배치
 * @param {THREE.Scene} scene
 * @param {object} options
 * @returns {Promise<{root: THREE.Group}>}
 */
export async function loadCar(scene, options = {}) {
  const {
    path = '/hyundai_ionic5.glb',
    position = new THREE.Vector3(0.3, 0, 4.88),
    rotation = new THREE.Euler(0, 0, 0, 'XYZ'),
    scale = 0.0115, // 스케일
  } = options;

  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      path,
      (gltf) => {
        const root = gltf.scene;
        root.name = 'car_root';
        root.position.copy(position);
        root.rotation.copy(rotation);
        root.scale.setScalar(scale);
        root.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        scene.add(root);
        resolve({ root });
      },
      undefined,
      (err) => reject(err),
    );
  });
}
