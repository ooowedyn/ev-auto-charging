// 씬, 로봇, 카메라 초기화

// frontend/src/app/setupScene.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { createScene } from '../viz/createScene.js';
import { RobotArm } from '../core/robotArm.js';
import { StereoRig } from '../viz/stereoRig.js';

// 도(deg) → 라디안(rad)
const RAD = (deg) => (deg * Math.PI) / 180;

/**
 * 씬/카메라/라이트/렌더러 생성 + 로봇/포트 모델 로드 + 프레임(Plug/Port) 구성
 * 이전 main.js 의 초기화/로딩 부분을 모듈화한 버전입니다.
 *
 * 반환:
 *  - scene, camera, renderer, controls, dir
 *  - robot (RobotArm 인스턴스)
 *  - stereo (StereoRig 인스턴스)
 *  - plugFrame, portFrame (월드 기준 결합 포즈 계산용)
 *  - ikTarget (IK 타깃 오브젝트)
 */
export async function setupScene() {
  // 1) 기본 씬 구성
  const { scene, camera, renderer, controls, dir } = createScene();

  // 2) IK 타깃 (메시는 숨김)
  const ikTarget = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0x57a6d9, metalness: 0.2, roughness: 0.6 })
  );
  ikTarget.visible = false;
  ikTarget.name = 'IK_TARGET';
  ikTarget.position.set(0.4, 0.9, 0.3);
  scene.add(ikTarget);

  // (선택) 디버그 화살표 – 기본은 숨김
  const ikArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), ikTarget.position, 0.2);
  ikArrow.visible = false;
  ikArrow.name = 'IK_ARROW';
  scene.add(ikArrow);

  // 3) 로봇 로드 + 조인트 연결
  const robot = new RobotArm();
  const loader = new GLTFLoader();

  // 주의: 모델 파일은 frontend/public/ 에 있어야 /untitled.glb 로 로드됩니다.
  const ur10Gltf = await loader.loadAsync('/untitled.glb');
  const ur10 = ur10Gltf.scene;
  ur10.rotation.x = Math.PI / 2;
  dir.intensity = 1.6;

  // 간단 머티리얼 팔레트 (원본 main.js 로직 반영)
  const PALETTE = { base: 0xb0b4b9, arm: 0xc8cdd3, joint: 0x2f3136, urblue: 0x57a6d9 };
  ur10.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.name || '').toLowerCase();
    let color = PALETTE.arm, metalness = 0.8, roughness = 0.35;
    if (name.includes('base') || name.includes('bracket')) { color = PALETTE.base; metalness = 0.85; roughness = 0.35; }
    if (name.includes('link')) { color = PALETTE.arm; metalness = 0.85; roughness = 0.3; }
    if (name.includes('motor') || name.includes('cap') || name.includes('cover')) { color = PALETTE.urblue; metalness = 0.4; roughness = 0.45; }
    if (name.includes('joint') || name.includes('ring') || name.includes('coupler')) { color = PALETTE.joint; metalness = 0.2; roughness = 0.55; }
    o.material = new THREE.MeshStandardMaterial({ color, metalness, roughness });
    o.castShadow = true;
    o.receiveShadow = true;
  });

  // 자동 스케일(약 1m 기준)
  {
    const box = new THREE.Box3().setFromObject(ur10);
    const size = new THREE.Vector3(), center = new THREE.Vector3();
    box.getSize(size); box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (isFinite(maxDim) && maxDim > 0 && (maxDim > 5 || maxDim < 0.05)) {
      const s = 1.0 / maxDim;
      ur10.scale.multiplyScalar(s);
      box.setFromObject(ur10);
      box.getSize(size); box.getCenter(center);
    }
    ur10.position.y += size.y / 2 - center.y;
  }

  scene.add(ur10);

  // 로봇 조인트 연결
  robot.attach(ur10);

  // 초기 관절 각도 설정 (원본 코드 반영)
  const initialAngles = {
    Motor1: RAD(0),
    Motor2: RAD(-55),
    Motor3: RAD(75),
    Motor4: RAD(-35),
    Motor5: RAD(80),
    Motor6: RAD(0),
    Motor7: RAD(0),
  };
  for (const [n, ang] of Object.entries(initialAngles)) {
    if (robot.joints[n]) robot.setJointAngle(n, ang);
  }
  if (typeof robot.applyFK === 'function') robot.applyFK();

  // 4) EE 팁 기준 좌표계(PlugFrame) + StereoRig 부착
  let plugFrame = null;
  let stereo = null;
  {
    const eeNode = robot.joints['Motor7'];
    if (eeNode) {
      const tipMount = new THREE.Object3D();
      tipMount.name = 'EE_TIP_MOUNT';
      tipMount.position.set(0, -0.15, -0.1);
      tipMount.rotation.set(-Math.PI / 2, 0, 0);
      eeNode.add(tipMount);

      plugFrame = new THREE.Object3D();
      plugFrame.name = 'PlugFrame';
      plugFrame.position.set(0.0, -0.10, -0.08);
      tipMount.add(plugFrame);

      stereo = new StereoRig({
        fov: 60, width: 640, height: 480,
        baseline: 0.06, near: 0.01, far: 20, zOffset: 0.0,
      });
      stereo.attachTo(tipMount);

      // (선택) 플러그 팁 시각화 마커
      const markerGeom = new THREE.SphereGeometry(0.015, 16, 16);
      const markerMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const plugMarker = new THREE.Mesh(markerGeom, markerMat);
      plugMarker.name = 'PlugMarker';
      scene.add(plugMarker);

      // 매 프레임 업데이트 시 plugMarker.position을 plugFrame 월드 위치로 복사하세요.
      // (루프에서: plugFrame.getWorldPosition(plugMarker.position))
    }
  }

  // 5) 충전 포트(Port) 로드 + PortFrame 생성
  const portGltf = await loader.loadAsync('/port.glb'); // public/port.glb
  const chargerRoot = portGltf.scene;
  chargerRoot.name = 'charger_root';

  // 위치/자세 (원본 코드 값)
  chargerRoot.position.set(1.1, 0.9, 0.0);
  chargerRoot.rotation.set(-Math.PI / 2, Math.PI / 9, Math.PI / 2);
  chargerRoot.scale.set(1, 1, 1);

  scene.add(chargerRoot);

  // 하위 노드에서 'Port'를 찾고, PortFrame 부착
  const chargerPort = chargerRoot.getObjectByName('Port');
  const chargerCap  = chargerRoot.getObjectByName('charger_cap');
  if (chargerCap) chargerCap.visible = false;

  const portFrame = new THREE.Object3D();
  portFrame.name = 'PortFrame';
  if (chargerPort) chargerPort.add(portFrame);
  else chargerRoot.add(portFrame);

  // (선택) 축 헬퍼
  const portAxes = new THREE.AxesHelper(0.1);
  portFrame.add(portAxes);
  if (plugFrame) {
    const plugAxes = new THREE.AxesHelper(0.1);
    plugFrame.add(plugAxes);
  }

  return {
    scene, camera, renderer, controls, dir,
    robot, stereo,
    plugFrame, portFrame,
    ikTarget,
  };
}
