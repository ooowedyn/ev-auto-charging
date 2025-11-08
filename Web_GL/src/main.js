/*
App Entry / bootstrap
---------------------------------------------------------
역할:
  - 씬/카메라/라이트/렌더러 생성(createScene)
  - GLTF 로드 및 RobotArm 조인트 연결
  - EE 팁(tipMount)에 StereoRig 부착
  - 뷰 모드(single/stereo/triple) 전환 및 메인 렌더 루프
  - IK(점 추종) + 조그 입력 통합

주요 의존성:
  - viz/createScene, viz/renderStereo, viz/renderTriple
  - core/robotArm, contro/inputController, sensors/stereoRig
  - config/jointMeta(조인트 매핑/축)

자주 수정하는 지점:
  - tipMount.position/rotation: 카메라 팁 위치 방향 보정
  - VIEW_MODE 기본값, HUB 표기 내용
  - GLTF 경로(public/untitled.glb)
*/
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { createScene } from './viz/createScene.js';
import { renderStereo } from './viz/renderStereo.js';
import { renderTriple } from './viz/renderTriple.js';

import { RobotArm } from './core/robotArm.js';
import { HUD } from './ui/hud.js';
import { InputController } from './control/inputController.js';
import { StereoRig } from './sensors/stereoRig.js';
import { JOINT_ORDER } from './config/jointMeta.js';

const RAD = (deg) => (deg * Math.PI) / 180;

let plugMarker = null;
let plugFrame = null;
let portFrame = null;
let lastPlugPos = null;
let lastPortPos = null;
let lastDiffPos = null;

let lastStepSent = 0;
const STEP_INTERVAL_MS = 100;

async function sendRlStep(state) {
  try {
    const res = await fetch('http://localhost:3000/api/rl/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    const data = await res.json();
    console.log('[RL] action from server', data.action);
    // 나중에 여기서 robot에 실제로 적용
  } catch (err) {
    console.error('[RL] step error', err);
  }
}

let frustumLObj = null;
let frustumRObj = null;

// ----- StereoCameraHead mock (RGB stereo head) -----
function makeStereoHead() {
  const group = new THREE.Group();
  group.name = 'StereoHead';

  // 본체 바디 (10cm x 3cm x 3cm 정도)
  const bodyW = 0.1; // x 방향 길이 10 cm
  const bodyH = 0.03; // y 방향 높이 3 cm
  const bodyD = 0.03; // z 방향 두께 3 cm

  const bodyGeom = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d32,
    metalness: 0.6,
    roughness: 0.35,
  });
  const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // 렌즈 2개 (baseline 약 6cm)
  const baseline = 0.06; // 6 cm
  const lensR = 0.009; // 렌즈 반지름 9 mm 정도
  const lensDepth = 0.005;

  const lensGeom = new THREE.CylinderGeometry(lensR, lensR, lensDepth, 32);
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x000814,
    metalness: 0.8,
    roughness: 0.2,
    emissive: 0x000000,
  });

  // 왼쪽 렌즈
  const lensL = new THREE.Mesh(lensGeom, lensMat);
  lensL.rotation.x = Math.PI / 2; // 실린더의 원면이 전방(z-)을 보도록
  lensL.castShadow = true;
  lensL.receiveShadow = true;
  // 본체 정면(전방)을 -Z 쪽으로 본다고 가정할게.
  lensL.position.set(-baseline / 2, 0, -bodyD / 2 - lensDepth / 2);
  group.add(lensL);

  // 오른쪽 렌즈
  const lensRMesh = new THREE.Mesh(lensGeom, lensMat);
  lensRMesh.rotation.x = Math.PI / 2;
  lensRMesh.castShadow = true;
  lensRMesh.receiveShadow = true;
  lensRMesh.position.set(baseline / 2, 0, -bodyD / 2 - lensDepth / 2);
  group.add(lensRMesh);

  // 디버그 축 (원하면 끄거나 크기 줄여도 됨)
  group.add(new THREE.AxesHelper(0.05));

  return group;
}

function makeDebugFrustum(cam, color = 0xffa500) {
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  cam.getWorldPosition(worldPos);
  cam.getWorldQuaternion(worldQuat);

  const near = cam.near;
  const far = cam.far;
  const fovRad = THREE.MathUtils.degToRad(cam.fov);

  const halfH_near = Math.tan(fovRad / 2) * near;
  const halfW_near = halfH_near * cam.aspect;
  const halfH_far = Math.tan(fovRad / 2) * far;
  const halfW_far = halfH_far * cam.aspect;

  // 카메라 로컬 좌표계 기준 코너들 (-Z가 전방)
  const localCorners = [
    new THREE.Vector3(-halfW_near, halfH_near, -near), // 0 near TL
    new THREE.Vector3(halfW_near, halfH_near, -near), // 1 near TR
    new THREE.Vector3(halfW_near, -halfH_near, -near), // 2 near BR
    new THREE.Vector3(-halfW_near, -halfH_near, -near), // 3 near BL
    new THREE.Vector3(-halfW_far, halfH_far, -far), // 4 far TL
    new THREE.Vector3(halfW_far, halfH_far, -far), // 5 far TR
    new THREE.Vector3(halfW_far, -halfH_far, -far), // 6 far BR
    new THREE.Vector3(-halfW_far, -halfH_far, -far), // 7 far BL
  ];

  // 카메라 월드 변환행렬 구성
  const worldMat = new THREE.Matrix4();
  worldMat.compose(worldPos, worldQuat, new THREE.Vector3(1, 1, 1));

  // 월드 좌표계 코너들
  const worldCorners = localCorners.map((p) => p.clone().applyMatrix4(worldMat));

  // 라인 세그먼트로 그릴 점들
  const pts = [];

  // 카메라 원점 -> far plane 4개 코너
  for (let i = 4; i < 8; i++) {
    pts.push(worldPos.clone(), worldCorners[i].clone());
  }

  // near plane 사각형
  pts.push(worldCorners[0].clone(), worldCorners[1].clone());
  pts.push(worldCorners[1].clone(), worldCorners[2].clone());
  pts.push(worldCorners[2].clone(), worldCorners[3].clone());
  pts.push(worldCorners[3].clone(), worldCorners[0].clone());

  // far plane 사각형
  pts.push(worldCorners[4].clone(), worldCorners[5].clone());
  pts.push(worldCorners[5].clone(), worldCorners[6].clone());
  pts.push(worldCorners[6].clone(), worldCorners[7].clone());
  pts.push(worldCorners[7].clone(), worldCorners[4].clone());

  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color });
  return new THREE.LineSegments(geom, mat);
}

const { scene, camera, renderer, controls, dir } = createScene();
const hud = new HUD();
const robot = new RobotArm();
let stereo = null;
let VIEW_MODE = 'triple';
window.VIEW_MODE = VIEW_MODE;
let chargerPort = null; // target socket mesh (for RL target pose)

// IK target
const ikTarget = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 16, 16),
  new THREE.MeshStandardMaterial({ color: 0x57a6d9, metalness: 0.2, roughness: 0.6 })
);
ikTarget.position.set(0.4, 0.9, 0.3);
scene.add(ikTarget);
const ikArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), ikTarget.position, 0.2);
scene.add(ikArrow);
const input = new InputController(robot, ikTarget);

// Load model(UR10)
const loader = new GLTFLoader();
loader.load('/untitled.glb', (gltf) => {
  const ur10 = gltf.scene;
  ur10.rotation.x = Math.PI / 2;
  dir.intensity = 1.6;

  // quick materials
  const PALETTE = { base: 0xb0b4b9, arm: 0xc8cdd3, joint: 0x2f3136, urblue: 0x57a6d9 };
  ur10.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.name || '').toLowerCase();
    let color = PALETTE.arm,
      metalness = 0.8,
      roughness = 0.35;
    if (name.includes('base') || name.includes('bracket')) {
      color = PALETTE.base;
      metalness = 0.85;
      roughness = 0.35;
    }
    if (name.includes('link')) {
      color = PALETTE.arm;
      metalness = 0.85;
      roughness = 0.3;
    }
    if (name.includes('motor') || name.includes('cap') || name.includes('cover')) {
      color = PALETTE.urblue;
      metalness = 0.4;
      roughness = 0.45;
    }
    if (name.includes('joint') || name.includes('ring') || name.includes('coupler')) {
      color = PALETTE.joint;
      metalness = 0.2;
      roughness = 0.55;
    }
    o.material = new THREE.MeshStandardMaterial({ color, metalness, roughness });
    o.castShadow = true;
    o.receiveShadow = true;
  });

  // autoscale to ~1m height
  const box = new THREE.Box3().setFromObject(ur10);
  const size = new THREE.Vector3(),
    center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (isFinite(maxDim) && maxDim > 0 && (maxDim > 5 || maxDim < 0.05)) {
    const s = 1.0 / maxDim;
    ur10.scale.multiplyScalar(s);
    box.setFromObject(ur10);
    box.getSize(size);
    box.getCenter(center);
  }
  ur10.position.y += size.y / 2 - center.y;
  scene.add(ur10);

  // attach robot joints
  robot.attach(ur10);

  // 초기 자세 설정: 로봇팔을 충전구 쪽으로 약간 더 전방/전진하도록 조정
  const initialAngles = {
    Motor1: RAD(20),   // 베이스를 약간 회전시켜 충전구 쪽을 향하게
    Motor2: RAD(-55),  // 어깨: 앞으로 숙이기
    Motor3: RAD(75),   // 팔꿈치: 적당히 굽히기
    Motor4: RAD(-35),  // 손목1: 자세 보정
    Motor5: RAD(80),   // 손목2: 카메라/충전건이 아래를 향하게
    Motor6: RAD(0),    // 손목3: 롤 기본값
    Motor7: RAD(0),    // EE 추가 축 (있다면)
  };
  for (const [name, angle] of Object.entries(initialAngles)) {
    if (robot.joints[name] != null) {
      robot.setJointAngle(name, angle);
    }
  }
  if (typeof robot.applyFK === 'function') {
    robot.applyFK();
  }

  // EE tip mount + stereo + plug frame
  const eeNode = robot.joints['Motor7'];
  if (eeNode) {
    const tipMount = new THREE.Object3D();
    tipMount.name = 'EE_TIP_MOUNT';

    // Motor7 로컬에서 실제 툴이 나가는 방향 쪽으로 조금 내밀고 싶으면 여기를 조정
    // ex) tipMount.position.set(0, 0, 0.15);
    tipMount.position.set(0, -0.15, -0.1);
    tipMount.rotation.set(-Math.PI / 2, 0, 0);

    eeNode.add(tipMount);

    // 충전건 팁 좌표계 (PlugFrame): tipMount 기준, 앞으로 약간 내민 위치라고 가정
    plugFrame = new THREE.Object3D();
    plugFrame.name = 'PlugFrame';
    // 필요에 따라 offset 조정 가능
    plugFrame.position.set(0.0, -0.10, -0.08);
    tipMount.add(plugFrame);

    // 스테레오 리그(실제 카메라 객체들: camL, camR)
    stereo = new StereoRig({
      fov: 60,
      width: 640,
      height: 480,
      baseline: 0.06, // <= 이게 위에서 만든 헤드 baseline과 일치
      near: 0.01,
      far: 20,
      zOffset: 0.0,
    });
    stereo.attachTo(tipMount);

    // 충전건 팁 위치 시각화를 위한 빨간 마커 생성 (한 번만 생성)
    if (!plugMarker) {
      const markerGeom = new THREE.SphereGeometry(0.015, 16, 16);
      const markerMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      plugMarker = new THREE.Mesh(markerGeom, markerMat);
      plugMarker.name = 'PlugMarker';
      scene.add(plugMarker);
    }
  }
});

// Load charger model (EV socket)
const chargerLoader = new GLTFLoader();
chargerLoader.load(
  '/port.glb',
  (gltf) => {
    const chargerRoot = gltf.scene;
    chargerRoot.name = 'charger_root';

    // place the charger in the scene (tweak as needed)
    chargerRoot.position.set(0.8, 0.9, 0.1);
    // Rotate the port so it faces the robot arm (tweak angles as needed)
    chargerRoot.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    chargerRoot.scale.set(1, 1, 1);

    // add to scene so it's visible
    scene.add(chargerRoot);
    chargerRoot.traverse((o) => {
      console.log('[charger child]', o.name);
    });

    // try to get specific sub-meshes if they exist
    chargerPort = chargerRoot.getObjectByName('Port');
    const chargerCap = chargerRoot.getObjectByName('charger_cap');

    // 충전구 결합 중심 좌표계 (PortFrame)
    portFrame = new THREE.Object3D();
    portFrame.name = 'PortFrame';
    if (chargerPort) {
      chargerPort.add(portFrame);
    } else {
      chargerRoot.add(portFrame);
    }
    // 연결 중심을 눈으로 보기 위한 축 표시
    const portAxes = new THREE.AxesHelper(0.1);
    portFrame.add(portAxes);

    // hide the cap if present (we only care about the socket)
    if (chargerCap) {
      chargerCap.visible = false;
    }

    console.log('[charger] loaded', chargerRoot, chargerPort, chargerCap);
  },
  undefined,
  (err) => {
    console.error('Failed to load charger model:', err);
  }
);

// loop
const clock = new THREE.Clock();
let lastT = performance.now();
let fps = 0;

function tick() {
  const t = clock.getElapsedTime();
  controls.update();

  // IK (with joint speed limiting)
  if (input.IK_ON && robot.root) {
    // 1) 현재 관절 각도 백업
    const prevAngles = {};
    for (const name of JOINT_ORDER) {
      prevAngles[name] = robot.angles[name] ?? 0;
    }

    // 2) IK로 목표 각도 계산 (충분히 수렴시키되, 실제 적용은 아래에서 제한)
    const ITER_PER_FRAME = 32;
    robot.solveIK_CCD(ikTarget.position, ITER_PER_FRAME, 1e-3);

    // 3) 프레임당 관절 최대 변화량 제한 (rad 단위)
    const MAX_STEP = 0.01; // 약 1.1도 정도

    for (const name of JOINT_ORDER) {
      const prev = prevAngles[name];
      const cur = robot.angles[name] ?? prev;
      let diff = cur - prev;

      if (diff > MAX_STEP) diff = MAX_STEP;
      else if (diff < -MAX_STEP) diff = -MAX_STEP;

      const limited = prev + diff;
      robot.setJointAngle(name, limited);
    }
  }
  ikArrow.position.copy(ikTarget.position);

  // held jog
  for (const n in input.HELD_JOG)
    if (robot.joints[n])
      robot.setJointAngle(n, (robot.angles[n] ?? 0) + input.HELD_JOG[n] * input.JOG_STEP);

  // HUD
  const now = performance.now();
  const dt = (now - lastT) / 1000;
  lastT = now;
  fps = 0.9 * fps + 0.1 * (1 / dt);
  let hudText = `| ${fps.toFixed(0)} fps`;
  // --- pose 읽기 (충전구 & 충전건 팁) ---
  if (plugFrame && portFrame) {
    // 월드 좌표계로 업데이트
    scene.updateMatrixWorld(true);

    // 충전구 결합 중심 pose (PortFrame)
    const portPos = new THREE.Vector3();
    const portQuat = new THREE.Quaternion();
    portFrame.getWorldPosition(portPos);
    portFrame.getWorldQuaternion(portQuat);

    const portEuler = new THREE.Euler();
    portEuler.setFromQuaternion(portQuat, 'XYZ');

    // 충전건 팁 pose (PlugFrame)
    const plugPos = new THREE.Vector3();
    const plugQuat = new THREE.Quaternion();
    plugFrame.getWorldPosition(plugPos);
    plugFrame.getWorldQuaternion(plugQuat);

    const plugEuler = new THREE.Euler();
    plugEuler.setFromQuaternion(plugQuat, 'XYZ');

    // 충전건 팁 마커를 월드 위치에 맞춰 이동
    if (plugMarker) {
      plugMarker.position.copy(plugPos);
    }

    // 최근 위치/차이 기록 (HUD 표시용)
    lastPlugPos = plugPos.clone();
    lastPortPos = portPos.clone();
    lastDiffPos = new THREE.Vector3().subVectors(portPos, plugPos);

    // RL state 후보 (dx,dy,dz,droll,dpitch,dyaw)
    const dx = portPos.x - plugPos.x;
    const dy = portPos.y - plugPos.y;
    const dz = portPos.z - plugPos.z;
    const droll = portEuler.x - plugEuler.x;
    const dpitch = portEuler.y - plugEuler.y;
    const dyaw = portEuler.z - plugEuler.z;

    const state = [dx, dy, dz, droll, dpitch, dyaw];

    const nowMs = performance.now();
    if (nowMs - lastStepSent > STEP_INTERVAL_MS) {
      lastStepSent = nowMs;
      sendRlStep(state);
    }
  }
  if (lastPlugPos && lastPortPos && lastDiffPos) {
    const p = lastPlugPos;
    const q = lastPortPos;
    const d = lastDiffPos;
    hudText += ` | plug (${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`;
    hudText += ` | port (${q.x.toFixed(3)}, ${q.y.toFixed(3)}, ${q.z.toFixed(3)})`;
    hudText += ` | diff (${d.x.toFixed(3)}, ${d.y.toFixed(3)}, ${d.z.toFixed(3)})`;
  }
  hud.update(robot, window.VIEW_MODE, hudText);
  // --- 디버그 프러스텀 갱신 ---
  if (stereo) {
    // 로봇 IK/FK 반영 후 최신 월드행렬로 갱신

    // 기존 라인 제거
    if (frustumLObj) scene.remove(frustumLObj);
    if (frustumRObj) scene.remove(frustumRObj);

    // 새 라인 생성 (camL 주황, camR 하늘색 등)
    frustumLObj = makeDebugFrustum(stereo.camL, 0xffa500);
    frustumRObj = makeDebugFrustum(stereo.camR, 0x00ffff);

    // 장면에 추가
    scene.add(frustumLObj);
    scene.add(frustumRObj);
  }
  // render
  if (window.VIEW_MODE === 'triple' && stereo) {
    renderTriple(renderer, scene, camera, stereo.camL, stereo.camR);
  } else if (window.VIEW_MODE === 'stereo' && stereo) {
    renderStereo(renderer, scene, stereo.camL, stereo.camR);
  } else {
    renderer.setClearColor(0x111318, 1);
    renderer.render(scene, camera);
  }

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
