// src/viz/loadCharger.js
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

export async function loadCharger(scene, position, rotation) {
  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      'Port.gltf',
      (gltf) => {
        const root = gltf.scene;
        root.name = 'charger_root';
        scene.add(root);

        // 배치 (너 장면 좌표계에 맞게 조정)
        root.position.copy(position || new THREE.Vector3(0.5, 1.0, 0.2));
        root.rotation.set(rotation?.x || 0, rotation?.y || 0, rotation?.z || 0);
        root.scale.set(1, 1, 1);

        // 파트 찾기
        const chargerPort = root.getObjectByName('charger_port');
        const chargerCap = root.getObjectByName('charger_cap');

        if (chargerCap) {
          chargerCap.visible = false;
        }

        resolve({ root, chargerPort, chargerCap });
      },
      undefined,
      (err) => reject(err)
    );
  });
}
