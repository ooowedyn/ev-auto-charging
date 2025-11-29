// src/main.js
/*
App Entry / bootstrap (compact)
- 씬 생성 / 모델 로드
- IK 타깃 이동(키보드)
- robotController로 IK 적용
*/
import * as THREE from 'three';

import { createScene } from './viz/createScene.js';
import { renderStereo } from './viz/renderStereo.js';
import { renderTriple } from './viz/renderTriple.js';
import { loadCharger } from './viz/loadCharger.js';

import { HUD } from './viz/hud.js';
import { SocketClient } from './network/socketClient.js';
import { initRobotSystem } from './core/robotSetup.js';
import { initKeyControls } from './ui/keyControls.js';
import { updateCameraFocus } from './ui/focusCamera.js';
import { refreshFrustums } from './viz/debugViz.js';
import { loadCar } from './viz/loadCar.js';
import { JOINT_ORDER } from './config/jointMeta.js';
import { getPose, matrixToPose, computeRelativePose } from './utils/poseUtils.js';

// 소켓 생성 (그냥 전역 노출함)
const socket = new SocketClient('ws://localhost:3000');
window.socket = socket;

const CONTROL_FOCUS = { USER: 'USER', ARM_CAM: 'ARM_CAM' };
let controlFocus = CONTROL_FOCUS.USER;
const setFocus = (next) => {
  controlFocus = next;
  input.setArmControlEnabled(next === CONTROL_FOCUS.ARM_CAM);
  if (next !== CONTROL_FOCUS.USER) Object.keys(camMoveKeys).forEach((k) => (camMoveKeys[k] = false));
  console.log('[FOCUS]', controlFocus);
};

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

// 마우스 입력 (ARM_CAM 포커스일 때 IK 타깃을 마우스로 이동)
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousedown', (e) => {
  if (e.button === 2) mouseState.right = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 2) mouseState.right = false;
});
window.addEventListener('mousemove', (e) => {
  if (controlFocus !== CONTROL_FOCUS.ARM_CAM || !mouseState.right || !ikTarget) return;
  const scale = 0.002;
  moveIkTargetLocal(e.movementX * scale, -e.movementY * scale, 0);
});
window.addEventListener('wheel', (e) => {
  if (controlFocus !== CONTROL_FOCUS.ARM_CAM || !ikTarget) return;
  const scale = 0.001;
  moveIkTargetLocal(0, 0, -e.deltaY * scale);
});

let plugMarker = null;
let plugFrame = null;
let portFrame = null;

let frustumState = { left: null, right: null };

const { scene, camera, renderer, controls, dir } = createScene();
const hud = new HUD();
const {
  robot,
  controller,
  input,
  ikTarget,
  moveIkTargetLocal,
  syncJointUI,
  loadPromise: robotLoadPromise,
} = initRobotSystem({ scene, camera, dir });
let stereo = null;
const camMoveKeys = {};
const mouseState = { right: false };
window.VIEW_MODE = 'triple';

// ✅ 키 입력 포커스 확보 (브라우저 단축키와 충돌 방지)
const canvas = renderer?.domElement ?? document.querySelector('#webgl');
if (canvas) {
  canvas.setAttribute('tabindex', '0');
  canvas.addEventListener('click', () => canvas.focus());
  canvas.focus();
}

// 키 입력 바인딩
initKeyControls({
  socket,
  captureAndSendFrame,
  getFocus: () => controlFocus,
  setFocus,
  camMoveKeys,
  robot,
});

// 로봇 모델 로드
robotLoadPromise.then(({ plugFrame: pf, stereo: st, plugMarker: pm }) => {
  plugFrame = pf;
  stereo = st;
  plugMarker = pm;
});

// 충전 포트 로드 (모듈화)
loadCharger(scene)
  .then(({ portFrame: pf }) => {
    portFrame = pf;
  })
  .catch((err) => console.error('Failed to load charger model:', err));

// 차량 로드 (예: 아이오닉5)
loadCar(scene).catch((err) => console.error('Failed to load car model:', err));


function captureAndSendFrame() {
  if (!plugFrame || !portFrame) {
    console.warn('[capture] plugFrame/portFrame not ready');
    return;
  }
  if (!stereo || !stereo.camL) {
    console.warn('[capture] stereo camL not ready');
    return;
  }
  // 디버그 시각화 요소 일시 숨김 (축/프러스텀 등)
  const prevStates = [];
  const hideObj = (obj) => {
    if (obj) {
      prevStates.push({ obj, vis: obj.visible });
      obj.visible = false;
    }
  };
  hideObj(frustumState.left);
  hideObj(frustumState.right);
  const tcp = getPose(plugFrame);
  const socketPose = getPose(portFrame);
  const tcpToSocket = computeRelativePose(tcp.matrix, socketPose.matrix);

  // --- camL 전용 640x480 캡처 ---
  const prevSize = new THREE.Vector2();
  renderer.getSize(prevSize);
  const prevRatio = renderer.getPixelRatio();

  const CAP_W = 640;
  const CAP_H = 480;
  renderer.setPixelRatio(1);
  renderer.setSize(CAP_W, CAP_H, false);
  renderer.render(scene, stereo.camL);

  const dataUrl = renderer.domElement.toDataURL('image/png');
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  // 원래 뷰 복원
  renderer.setPixelRatio(prevRatio);
  renderer.setSize(prevSize.x, prevSize.y, false);
  // 디버그 시각화 복원
  prevStates.forEach(({ obj, vis }) => { obj.visible = vis; });

  const packet = {
    frameId: Date.now(),
    timestamp: Date.now(),
    image: { mime: 'image/png', encoding: 'base64', width: CAP_W, height: CAP_H, data: base64 },
    tcpPoseWorld: matrixToPose(tcp.matrix),
    socketPoseWorld: matrixToPose(socketPose.matrix),
    tcpToSocketPose: tcpToSocket,
    joints: JOINT_ORDER.map((n) => robot.angles[n] ?? 0),
    meta: { cameraId: 'stereo_camL', sceneId: 'default_scene' },
  };
  socket.send('frame', packet);
  console.log('[capture] frame packet sent');
}

// 디버그 프러스텀 생성 함수
// 메인 루프
const clock = new THREE.Clock();
let lastT = performance.now();
let fps = 0;

function tick() {
  // ✅ IK 타깃/조인트 변화가 즉시 반영되도록 월드행렬 먼저 갱신
  scene.updateMatrixWorld(true);

  // 포커스에 따라 카메라 제어
  updateCameraFocus(controlFocus, { controls, camera, camMoveKeys });

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

  // 슬라이더 UI를 현재 관절 상태로 동기화
  if (syncJointUI) syncJointUI();

  // 프러스텀 디버그 라인 갱신
  if (stereo) {
    frustumState = refreshFrustums(scene, stereo, frustumState);
  }

  // HUD
  const now = performance.now();
  const dt = (now - lastT) / 1000;
  lastT = now;
  fps = 0.9 * fps + 0.1 * (1 / dt);
  let tcpPose = null, socketPose = null, relPose = null;
  if (plugFrame && portFrame) {
    tcpPose = matrixToPose(plugFrame.matrixWorld);
    socketPose = matrixToPose(portFrame.matrixWorld);
    const relMat = plugFrame.matrixWorld.clone().invert().multiply(portFrame.matrixWorld);
    relPose = matrixToPose(relMat);
  }
  hud.updateWithPoses({
    robot,
    viewMode: `${window.VIEW_MODE} | FOCUS:${controlFocus}`,
    fps,
    ikOn: input.IK_ON,
    tcpPose,
    socketPose,
    relPose,
  });

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
