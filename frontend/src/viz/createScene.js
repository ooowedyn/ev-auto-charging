/*
createScene: Scene/Camera/Renderer/Lighting Factory
------------------------------------------------------------
역할:
  - 씬/카메라/렌더러/OrbitControls 초기화
  - 바닥/그리드/조명 구성, 리사이즈 핸들러
  
주요 Export:
  - function createScene() -> {scene, camera, renderer, controls, dir}

자주 수정하는 지점:
  - 카메라 기본 위치/파라미터, 라이트 강도/방향
  - 바닥/그리드 스타일
*/
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function createScene(canvas) {
  const scene = new THREE.Scene();
  // 살짝 어두운 야외 톤
  scene.background = new THREE.Color(0x8ca0b3);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(3.5, 2.2, 4.2);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // OribitControls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.8, 0);
  controls.update();

  // 메쉬 구성
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({
      color: 0x6a7079,   // 더 어두운 콘크리트 톤
      roughness: 0.98,   // 더 거칠게
      metalness: 0.0,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(20, 20, 0x707780, 0x828a94);
  grid.position.y = 0.001;
  scene.add(grid);

  // 조명
  // 전역 앰비언트 (균일한 저조도)
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  // 부드러운 하늘/바닥 분위기
const hemi = new THREE.HemisphereLight(0xddeeff, 0x20232b, 0.6);
scene.add(hemi);

// 메인 키라이트 (기존 dir, 약간 따뜻한 흰색)
const dir = new THREE.DirectionalLight(0xffffff, 1.4);
dir.position.set(-5, 8, 5); // 자동차가 서 있는 방향에 맞춰 역광 방지 (X를 음수로)
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.near = 0.5;
dir.shadow.camera.far = 30;
scene.add(dir);

// 소프트 필라이트 (그림자 너무 까맣지 않게)
const fillLight = new THREE.DirectionalLight(0xb0c4ff, 0.4);
fillLight.position.set(-4, 3, -3);
scene.add(fillLight);

// 뒤에서 비추는 림라이트 (엣지 강조)
const rimLight = new THREE.DirectionalLight(0x88aaff, 0.5);
rimLight.position.set(-3, 5, 4);
scene.add(rimLight);

// 로봇 반대쪽 추가 필라이트 (밝기 보정)
const fillDir = new THREE.DirectionalLight(0xffffff, 0.4);
fillDir.position.set(-4, 3, -4);
scene.add(fillDir);

// 카메라에 장착된 스포트라이트 (스테레오 카메라가 보는 물체 강조)
const spot = new THREE.SpotLight(0xffffff, 2.2, 10, Math.PI / 6, 0.25, 1.0);
spot.castShadow = true;
spot.shadow.mapSize.set(1024, 1024);
spot.shadow.camera.near = 0.1;
spot.shadow.camera.far = 20;
spot.position.set(0, 0, 0.2); // 카메라 바로 앞쪽
spot.target.position.set(0, 0, -1); // 기본적으로 카메라 전방 조준
camera.add(spot);
camera.add(spot.target);
scene.add(spot);

  // 컨트롤
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  return { scene, camera, renderer, controls, dir };
}
