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

  // EE tip mount + stereo
  const eeNode = robot.joints['Motor7'];
  if (eeNode) {
    const tipMount = new THREE.Object3D();
    tipMount.name = 'EE_TIP_MOUNT';

    // Motor7 로컬에서 실제 툴이 나가는 방향 쪽으로 조금 내밀고 싶으면 여기를 조정
    // ex) tipMount.position.set(0, 0, 0.15);
    tipMount.position.set(0, -0.15, -0.1);
    tipMount.rotation.set(-Math.PI / 2, 0, 0);

    eeNode.add(tipMount);

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
    chargerRoot.position.set(0.8, 0.9, 0.2);
    // Rotate the port so it faces the robot arm (tweak angles as needed)
    chargerRoot.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    chargerRoot.scale.set(1, 1, 1);

    // add to scene so it's visible
    scene.add(chargerRoot);

    // try to get specific sub-meshes if they exist
    chargerPort = chargerRoot.getObjectByName('charger_port');
    const chargerCap = chargerRoot.getObjectByName('charger_cap');

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

  // IK
  if (input.IK_ON && robot.root) robot.solveIK_CCD(ikTarget.position, 32, 1e-3);
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
  hud.update(robot, window.VIEW_MODE, `| ${fps.toFixed(0)} fps`);
  // --- pose 읽기 (충전구 & EE) ---
  if (chargerPort && robot.joints['Motor7']) {
    // 월드 좌표계로 업데이트
    scene.updateMatrixWorld(true);

    // 충전구 포트 pose
    const portPos = new THREE.Vector3();
    const portQuat = new THREE.Quaternion();
    chargerPort.getWorldPosition(portPos);
    chargerPort.getWorldQuaternion(portQuat);

    const portEuler = new THREE.Euler();
    portEuler.setFromQuaternion(portQuat, 'XYZ');

    // EE pose (end effector)
    const eeNode = robot.joints['Motor7'];
    const eePos = new THREE.Vector3();
    const eeQuat = new THREE.Quaternion();
    eeNode.getWorldPosition(eePos);
    eeNode.getWorldQuaternion(eeQuat);

    const eeEuler = new THREE.Euler();
    eeEuler.setFromQuaternion(eeQuat, 'XYZ');

    // 디버그 출력(잠깐만 보고 나중에 주석처리)
    // console.log('[pose]',
    //   'target=', portPos, portEuler,
    //   'ee=', eePos, eeEuler
    // );

    // RL state 후보 (dx,dy,dz,droll,dpitch,dyaw)
    const dx = portPos.x - eePos.x;
    const dy = portPos.y - eePos.y;
    const dz = portPos.z - eePos.z;
    const droll = portEuler.x - eeEuler.x;
    const dpitch = portEuler.y - eeEuler.y;
    const dyaw = portEuler.z - eeEuler.z;

    // 이걸 나중에 Python 서버(/step)로 보낼 거야.
    // fetch(...)로 보내고 action 받아서 robot.setJointAngle() 등으로 적용.
    // 지금은 로컬에서 값만 잘 나오는지 보면 돼.
  }
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
