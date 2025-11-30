// src/viz/loadCharger.js
// 충전구(GLB) 로드 + 배치 + 재질 보정 + 포트 프레임 생성
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export async function loadCharger(scene, options = {}) {
  const {
    path = '/port.glb',
    position = new THREE.Vector3(0.58, 1.08, 0.0),
    rotation = new THREE.Euler(Math.PI/2, Math.PI*1.88, Math.PI / 2, 'XYZ'),
    portName = 'Port',
    portFrameName = 'PortFrame',
    // 기본값을 “텍스처/재질 완전 덮어쓰기 + 노멀 재계산”으로 설정
    materialAdjust = { color: 0x0f0f0f, metalness: 0.02, roughness: 0.85 },
    replaceMaterial = true, // 기존 CAD 텍스처/재질 완전 무시
    applyToAll = true, // 전체 메쉬에 적용
    alwaysRecomputeNormals = true, // 법선 뒤집힘 방지
    customMaterial = null, // MeshStandardMaterial 인스턴스나 팩토리 함수(o)=>material
  } = options;

  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      path,
      (gltf) => {
        const root = gltf.scene;
        root.name = 'charger_root';

        // 배치/회전
        root.position.copy(position);
        root.setRotationFromEuler(rotation);
        root.scale.set(1, 1, 1);

        // 재질 보정:
        // - replaceMaterial=true : 대상 메쉬 재질/텍스처를 완전히 덮어씌움
        // - replaceMaterial=false: 기존 재질 유지, (portName에 한해) 색/메탈/거칠기만 조정
        const targetName = (portName || '').toLowerCase();
        root.traverse((o) => {
          if (!o.isMesh) return;
          if (o.material?.vertexColors) o.material.vertexColors = false;
          if (alwaysRecomputeNormals && o.geometry) o.geometry.computeVertexNormals();

          const name = (o.name || '').toLowerCase();
          const isTarget = applyToAll || name.includes(targetName);

          if (replaceMaterial && isTarget) {
            let mat = typeof customMaterial === 'function' ? customMaterial(o) : customMaterial;
            if (!mat) {
              mat = new THREE.MeshStandardMaterial({
                color: materialAdjust.color ?? 0x0f0f0f,
                roughness: materialAdjust.roughness ?? 0.85,
                metalness: materialAdjust.metalness ?? 0.05,
              });
            } else if (mat.isMaterial && mat.clone) {
              mat = mat.clone(); // 메쉬마다 독립 재질
            }
            o.material = mat;
          } else if (isTarget) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => {
              if (!m) return;
              if (m.color && materialAdjust.color != null) m.color.set(materialAdjust.color ?? 0x0f0f0f);
              if ('metalness' in m && materialAdjust.metalness != null) m.metalness = materialAdjust.metalness;
              if ('roughness' in m && materialAdjust.roughness != null) m.roughness = materialAdjust.roughness;
            });
          }
          o.castShadow = true;
          o.receiveShadow = true;
        });

        scene.add(root);

        const chargerPort = root.getObjectByName(portName) || null;
        const chargerCap = root.getObjectByName('charger_cap') || null;
        if (chargerCap) chargerCap.visible = false;

        const portFrame = new THREE.Object3D();
        portFrame.name = portFrameName;
        (chargerPort ?? root).add(portFrame);

        resolve({ root, chargerPort, chargerCap, portFrame });
      },
      undefined,
      (err) => reject(err),
    );
  });
}
