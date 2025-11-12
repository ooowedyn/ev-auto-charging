// src/main.js
/*
App Entry / bootstrap (compact)
- 씬 생성 / 모델 로드
- IK 타깃 이동(키보드)
- robotController로 IK 적용
*/
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { createScene } from './viz/createScene.js';
import { renderStereo } from './viz/renderStereo.js';
import { renderTriple } from './viz/renderTriple.js';

import { RobotArm } from './core/robotArm.js';
import { RobotController } from './core/robotController.js';
import { HUD } from './ui/hud.js';
import { InputController } from './ui/inputController.js';
import { StereoRig } from './sensors/stereoRig.js';
import { JOINT_ORDER } from './config/jointMeta.js';

import { SocketClient } from './network/socketClient.js';

// 소켓 생성 (그냥 전역 노출함)
const socket = new SocketClient('ws://localhost:3000');
window.socket = socket;

// RL 액션 수신 → 로봇에 적용
socket.on('rl-action', (data) => {
  console.log('[WS] rl-action received:', data);
  controller.applyRLAction(data);
});

// (선택) request-frame을 서버가 보낼 수도 있지만,
// 보통은 프론트가 주도적으로 스트리밍 시작.
socket.startFrameStreaming(
  () => renderer.domElement.toDataURL('image/jpeg', 0.7),
  5 // fps
);

// (선택) 주기적 포즈 전송 (0.5초 간격 예시)
let _poseTimer = setInterval(() => {
  // JOINT_ORDER가 있다면 순서 보장해서 보내기
  const joints = JOINT_ORDER.map((n) => robot.angles[n] ?? 0);
  socket.send('pose-update', { joints });
}, 500);

// 서버에서 pose-update 수신
socket.on('pose-update', (data) => {
  console.log('서버로부터 pose-update 수신:', data);
});

// 키 입력으로 pose 전송 (예시)
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') {
    const joints = Object.values(robot.angles);
    socket.send('pose-update', { joints });
    console.log('[WS] pose sent');
  }
});

const RAD = (deg) => (deg * Math.PI) / 180;

let plugMarker = null;
let plugFrame = null;
let portFrame = null;

let frustumLObj = null;
let frustumRObj = null;

const { scene, camera, renderer, controls, dir } = createScene();
const hud = new HUD();
const robot = new RobotArm();
const controller = new RobotController(robot);
let stereo = null;
window.VIEW_MODE = 'triple';

// ✅ 키 입력 포커스 확보 (브라우저 단축키와 충돌 방지)
const canvas = renderer?.domElement ?? document.querySelector('#webgl');
if (canvas) {
  canvas.setAttribute('tabindex', '0');
  canvas.addEventListener('click', () => canvas.focus());
  canvas.focus();
}
// 선택적으로 특정 키에 대해 기본 동작 방지
window.addEventListener('keydown', (e) => {
  const block = ['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','Space','Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','KeyZ','KeyF','KeyG','KeyU','KeyI','KeyO','Digit8','Digit9','Digit0'];
  if (block.includes(e.code)) e.preventDefault();
}, { passive: false });

// IK target (디버깅 가시화 ON)
const ikTarget = new THREE.Mesh(
  new THREE.SphereGeometry(0.03, 16, 16),
  new THREE.MeshStandardMaterial({ color: 0x57a6d9, metalness: 0.2, roughness: 0.6 })
);
ikTarget.position.set(0.4, 0.9, 0.3);
ikTarget.visible = true; // ← 디버깅용으로 보이게
ikTarget.name = 'IK_TARGET';
scene.add(ikTarget);

const input = new InputController(robot, ikTarget);
input.IK_ON = true; // 기본 ON (원하시면 false)

// 로봇 모델 로드
const loader = new GLTFLoader();
loader.load('/untitled.glb', (gltf) => {
  const ur10 = gltf.scene;
  ur10.rotation.x = Math.PI / 2;
  dir.intensity = 1.6;

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
    o.castShadow = true; o.receiveShadow = true;
  });

  // autoscale
  const box = new THREE.Box3().setFromObject(ur10);
  const size = new THREE.Vector3(), center = new THREE.Vector3();
  box.getSize(size); box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (isFinite(maxDim) && maxDim > 0 && (maxDim > 5 || maxDim < 0.05)) {
    ur10.scale.multiplyScalar(1.0 / maxDim);
  }
  // 바닥 위에 올리기
  const box2 = new THREE.Box3().setFromObject(ur10);
  const size2 = new THREE.Vector3(), center2 = new THREE.Vector3();
  box2.getSize(size2); box2.getCenter(center2);
  ur10.position.y += size2.y / 2 - center2.y;

  scene.add(ur10);
  robot.attach(ur10);

  // 초기 관절
  const initialAngles = {
    Motor1: RAD(0),
    Motor2: RAD(-55),
    Motor3: RAD(75),
    Motor4: RAD(-35),
    Motor5: RAD(80),
    Motor6: RAD(0),
    Motor7: RAD(0),
  };
  for (const [name, angle] of Object.entries(initialAngles)) {
    if (robot.joints[name]) robot.setJointAngle(name, angle);
  }
  robot.applyFK();

  // EE tip mount + stereo + PlugFrame
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

    const axes = new THREE.AxesHelper(0.1);
    plugFrame.add(axes);

    stereo = new StereoRig({ fov: 60, width: 640, height: 480, baseline: 0.06, near: 0.01, far: 20, zOffset: 0.0 });
    stereo.attachTo(tipMount);

    if (!plugMarker) {
      const markerGeom = new THREE.SphereGeometry(0.015, 16, 16);
      const markerMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      plugMarker = new THREE.Mesh(markerGeom, markerMat);
      plugMarker.name = 'PlugMarker';
      scene.add(plugMarker);
    }
  }
});

// 충전 포트 로드
const chargerLoader = new GLTFLoader();
chargerLoader.load(
  '/port.glb',
  (gltf) => {
    const chargerRoot = gltf.scene;
    chargerRoot.name = 'charger_root';
    chargerRoot.position.set(1.1, 0.9, 0.0);
    chargerRoot.rotation.set(-Math.PI / 2, Math.PI / 9, Math.PI / 2);
    chargerRoot.scale.set(1, 1, 1);

    scene.add(chargerRoot);

    const chargerPort = chargerRoot.getObjectByName('Port');
    const chargerCap = chargerRoot.getObjectByName('charger_cap');
    if (chargerCap) chargerCap.visible = false;

    portFrame = new THREE.Object3D();
    portFrame.name = 'PortFrame';
    (chargerPort ?? chargerRoot).add(portFrame);
    portFrame.add(new THREE.AxesHelper(0.1));
  },
  undefined,
  (err) => console.error('Failed to load charger model:', err)
);

// 디버그 프러스텀 생성 함수
function makeDebugFrustum(cam, color = 0xffa500) {
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
    new THREE.Vector3(-halfW_near,  halfH_near, -near),
    new THREE.Vector3( halfW_near,  halfH_near, -near),
    new THREE.Vector3( halfW_near, -halfH_near, -near),
    new THREE.Vector3(-halfW_near, -halfH_near, -near),
    new THREE.Vector3(-halfW_far,   halfH_far,  -far),
    new THREE.Vector3( halfW_far,   halfH_far,  -far),
    new THREE.Vector3( halfW_far,  -halfH_far,  -far),
    new THREE.Vector3(-halfW_far,  -halfH_far,  -far),
  ];
  const worldMat = new THREE.Matrix4().compose(worldPos, worldQuat, new THREE.Vector3(1,1,1));
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
  const mat = new THREE.LineBasicMaterial({ color });
  return new THREE.LineSegments(geom, mat);
}

// 메인 루프
const clock = new THREE.Clock();
let lastT = performance.now();
let fps = 0;

function tick() {
  // ✅ IK 타깃/조인트 변화가 즉시 반영되도록 월드행렬 먼저 갱신
  scene.updateMatrixWorld(true);

  controls.update();

  // 조그(JOG) 반영
  for (const n in input.HELD_JOG) {
    if (robot.joints[n]) {
      robot.setJointAngle(n, (robot.angles[n] ?? 0) + input.HELD_JOG[n] * input.JOG_STEP);
    }
  }

  // IK 적용 (robotController 사용)
  if (input.IK_ON && robot.root && ikTarget) {
    controller.applyIK(ikTarget.position);
  }

  // FK 반영
  robot.applyFK();

  // 플러그 팁 마커 위치 동기화
  if (plugMarker && plugFrame) plugFrame.getWorldPosition(plugMarker.position);

  // 프러스텀 디버그 라인 갱신
  if (stereo) {
    if (frustumLObj) scene.remove(frustumLObj);
    if (frustumRObj) scene.remove(frustumRObj);
    frustumLObj = makeDebugFrustum(stereo.camL, 0xffa500);
    frustumRObj = makeDebugFrustum(stereo.camR, 0x00ffff);
    scene.add(frustumLObj); scene.add(frustumRObj);
  }

  // HUD
  const now = performance.now();
  const dt = (now - lastT) / 1000;
  lastT = now;
  fps = 0.9 * fps + 0.1 * (1 / dt);
  hud.update(robot, window.VIEW_MODE, `FPS ${fps.toFixed(0)} | IK:${input.IK_ON ? 'ON':'OFF'}`);

  // 렌더링
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
