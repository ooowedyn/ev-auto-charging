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
import { getIntrinsicsFromCamera } from './utils/coords.js';

// 소켓 생성 (그냥 전역 노출함)
const socket = new SocketClient('ws://localhost:3101');
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
socket.on('vision-result', (data) => {
  if (!data) return;
  lastDetections = {
    boxes: data.boxes || [],
    imgW: data.imgW || data.width || 640,
    imgH: data.imgH || data.height || 480,
    names: data.names || null,
  };
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
let chargerPortMesh = null;
let plugCam = null;
let plugCamRenderer = null;
let overlay2d = null;
let lastDetections = null;
let lastKeyAction = '';
let detectStreaming = false;
let detectTimer = null;

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
  captureAndSendMainCamFrame,
  sendDetection: toggleDetectStreaming,
  getFocus: () => controlFocus,
  setFocus,
  camMoveKeys,
  robot,
});

// 로봇 모델 로드
robotLoadPromise.then(({ plugFrame: pf, stereo: st, plugMarker: pm, plugCam: pc }) => {
  plugFrame = pf;
  stereo = st;
  plugMarker = pm;
  plugCam = pc || null;
});

// 충전 포트 로드 (모듈화)
loadCharger(scene)
  .then(({ portFrame: pf, chargerPort }) => {
    portFrame = pf;
    chargerPortMesh = chargerPort || null;
  })
  .catch((err) => console.error('Failed to load charger model:', err));

// 차량 로드 (예: 아이오닉5)
loadCar(scene).catch((err) => console.error('Failed to load car model:', err));


function captureAndSendFrame() {
  const data = captureStereoData();
  if (!data) return;
  const {
    leftBase64,
    rightBase64,
    tcpPoseWorld,
    socketPoseWorld,
    tcpToSocket,
    camPose,
    dist,
    visibleLeft,
    visibleRight,
  } = data;
  const CAP_W = 640;
  const CAP_H = 480;
  const packet = {
    type: 'frame',
    frameId: Date.now(),
    timestamp: Date.now(),
    image: {
      left: { mime: 'image/png', encoding: 'base64', width: CAP_W, height: CAP_H, data: leftBase64 },
      right: { mime: 'image/png', encoding: 'base64', width: CAP_W, height: CAP_H, data: rightBase64 },
    },
    tcpPoseWorld: matrixToPose(tcpPoseWorld.matrix),
    socketPoseWorld: matrixToPose(socketPoseWorld.matrix),
    tcpToSocketPose: tcpToSocket,
    camPose,
    visible: { left: visibleLeft, right: visibleRight },
    dist,
    joints: JOINT_ORDER.map((n) => robot.angles[n] ?? 0),
    meta: {
      cameraId: 'stereo',
      sceneId: 'default_scene',
      intrinsics: getIntrinsicsFromCamera(stereo.camL, CAP_W, CAP_H),
    },
  };
  socket.send('frame', packet);
  console.log('[capture] frame packet sent (stereo)');
  lastKeyAction = 'L: frame saved & sent';
}

// 메인 카메라 캡처 (M 키)
function captureAndSendMainCamFrame() {
  const data = captureMainCamData();
  if (!data) return;
  const {
    mainBase64,
    tcpPoseWorld,
    camPoseWorld,
    socketPoseWorld,
    camToSocket,
    dist,
    visibleMain,
  } = data;

  const CAP_W = 640;
  const CAP_H = 480;
  const packet = {
    type: 'frame',
    frameId: Date.now(),
    timestamp: Date.now(),
    image: {
      main: { mime: 'image/png', encoding: 'base64', width: CAP_W, height: CAP_H, data: mainBase64 },
    },
    tcpPoseWorld: matrixToPose(tcpPoseWorld.matrix),
    camPoseWorld: matrixToPose(camPoseWorld.matrix),
    socketPoseWorld: matrixToPose(socketPoseWorld.matrix),
    camPose: { main: matrixToPose(camPoseWorld.matrix) },
    camToSocketPose: camToSocket,
    visible: { main: visibleMain },
    dist,
    joints: JOINT_ORDER.map((n) => robot.angles[n] ?? 0),
    meta: {
      cameraId: 'main',
      sceneId: 'default_scene',
      intrinsics: getIntrinsicsFromCamera(camera, CAP_W, CAP_H),
    },
  };
  socket.send('frame', packet);
  console.log('[capture] frame packet sent (main cam)');
  lastKeyAction = 'M: main cam saved & sent';
}

// 공용 스테레오 캡처 (L/R 및 포즈/가시성 포함)
function captureStereoData() {
  if (!plugFrame || !portFrame) {
    console.warn('[capture] plugFrame/portFrame not ready');
    return null;
  }
  if (!stereo || !stereo.camL || !stereo.camR) {
    console.warn('[capture] stereo cams not ready');
    return null;
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
  const tcpPoseWorld = getPose(plugFrame);
  const socketPoseWorld = getPose(portFrame);
  const tcpToSocket = computeRelativePose(tcpPoseWorld.matrix, socketPoseWorld.matrix);
  const dist = tcpToSocket.position ? Math.hypot(tcpToSocket.position.x, tcpToSocket.position.y, tcpToSocket.position.z) : null;
  const targetMesh = chargerPortMesh || portFrame;
  const visibleLeft = isInViewFrustum(stereo.camL, targetMesh) ? 1 : 0;
  const visibleRight = isInViewFrustum(stereo.camR, targetMesh) ? 1 : 0;

  // --- 스테레오 640x480 캡처 ---
  const prevSize = new THREE.Vector2();
  renderer.getSize(prevSize);
  const prevRatio = renderer.getPixelRatio();

  const CAP_W = 640;
  const CAP_H = 480;
  renderer.setPixelRatio(1);
  renderer.setSize(CAP_W, CAP_H, false);

  const captureCam = (cam) => {
    renderer.render(scene, cam);
    const dataUrl = renderer.domElement.toDataURL('image/png');
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  };

  const leftBase64 = captureCam(stereo.camL);
  const rightBase64 = captureCam(stereo.camR);

  // 원래 뷰 복원
  renderer.setPixelRatio(prevRatio);
  renderer.setSize(prevSize.x, prevSize.y, false);
  // 디버그 시각화 복원
  prevStates.forEach(({ obj, vis }) => { obj.visible = vis; });

  return {
    leftBase64,
    rightBase64,
    tcpPoseWorld,
    socketPoseWorld,
    tcpToSocket,
    dist,
    visibleLeft,
    visibleRight,
    camPose: {
      left: matrixToPose(stereo.camL.matrixWorld),
      right: matrixToPose(stereo.camR.matrixWorld),
    },
  };
}

// 메인 카메라 캡처 데이터
function captureMainCamData() {
  if (!plugFrame || !portFrame) {
    console.warn('[capture] plugFrame/portFrame not ready');
    return null;
  }
  // 디버그 시각화 숨김 (프러스텀 등)
  const prevStates = [];
  const hideObj = (obj) => {
    if (obj) {
      prevStates.push({ obj, vis: obj.visible });
      obj.visible = false;
    }
  };
  hideObj(frustumState.left);
  hideObj(frustumState.right);

  const tcpPoseWorld = getPose(plugFrame);
  const camPoseWorld = getPose(camera);
  const socketPoseWorld = getPose(portFrame);
  const camToSocket = computeRelativePose(camPoseWorld.matrix, socketPoseWorld.matrix);
  const dist = camToSocket.position ? Math.hypot(camToSocket.position.x, camToSocket.position.y, camToSocket.position.z) : null;
  const targetMesh = chargerPortMesh || portFrame;
  const visibleMain = isInViewFrustum(camera, targetMesh) ? 1 : 0;

  // 캡처
  const prevSize = new THREE.Vector2();
  renderer.getSize(prevSize);
  const prevRatio = renderer.getPixelRatio();

  const CAP_W = 640;
  const CAP_H = 480;
  renderer.setPixelRatio(1);
  renderer.setSize(CAP_W, CAP_H, false);
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  const mainBase64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  // 원래 뷰 복원
  renderer.setPixelRatio(prevRatio);
  renderer.setSize(prevSize.x, prevSize.y, false);
  prevStates.forEach(({ obj, vis }) => { obj.visible = vis; });

  return {
    mainBase64,
    tcpPoseWorld,
    camPoseWorld,
    socketPoseWorld,
    camToSocket,
    dist,
    visibleMain,
  };
}

// YOLO 추론 요청 (1회 전송)
function sendStereoForDetection() {
  const data = captureStereoData();
  if (!data) return;
  const payload = {
    leftImageBase64: `data:image/png;base64,${data.leftBase64}`,
    rightImageBase64: `data:image/png;base64,${data.rightBase64}`,
    ts: Date.now(),
  };
  socket.send('stereo-frame', payload);
  lastKeyAction = detectStreaming ? 'K: detect streaming...' : 'K: detect frame sent';
}

// K 토글: 실시간 스트리밍 on/off
function toggleDetectStreaming() {
  detectStreaming = !detectStreaming;
  if (detectStreaming) {
    if (detectTimer) clearInterval(detectTimer);
    detectTimer = setInterval(() => sendStereoForDetection(), 1500);
    lastKeyAction = 'K: detect streaming ON';
  } else {
    if (detectTimer) clearInterval(detectTimer);
    detectTimer = null;
    lastKeyAction = 'K: detect streaming OFF';
  }
}

// 디버그 프러스텀 생성 함수
// 메인 루프
const clock = new THREE.Clock();
let lastT = performance.now();
let fps = 0;
function ensurePlugCamPreview() {
  if (plugCamRenderer) return;
  plugCamRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  plugCamRenderer.setPixelRatio(1);
  plugCamRenderer.setSize(240, 180, false);
  const el = plugCamRenderer.domElement;
  el.style.cssText =
    'position:fixed;bottom:10px;left:50%;transform:translateX(-50%);width:240px;height:180px;border:1px solid #3a3f4b;background:#000;z-index:12;pointer-events:none;';
  document.body.appendChild(el);
}

function ensureOverlay2d() {
  if (overlay2d) return overlay2d;
  const canvas2d = document.createElement('canvas');
  canvas2d.width = renderer.domElement.clientWidth;
  canvas2d.height = renderer.domElement.clientHeight;
  canvas2d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:13;';
  document.body.appendChild(canvas2d);
  overlay2d = canvas2d.getContext('2d');
  return overlay2d;
}

function isInViewFrustum(cam, obj) {
  if (!cam || !obj) return false;
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const frustum = new THREE.Frustum();
  const proj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const box = new THREE.Box3().setFromObject(obj);
  frustum.setFromProjectionMatrix(proj);
  return frustum.intersectsBox(box);
}

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
  let camRelPose = null, distCam = null, visMain = null;
  if (plugFrame && portFrame) {
    tcpPose = matrixToPose(plugFrame.matrixWorld);
    socketPose = matrixToPose(portFrame.matrixWorld);
    const relMat = plugFrame.matrixWorld.clone().invert().multiply(portFrame.matrixWorld);
    relPose = matrixToPose(relMat);

    const camToSocket = computeRelativePose(camera.matrixWorld, portFrame.matrixWorld);
    camRelPose = camToSocket;
    const p = camToSocket.position || {};
    distCam = Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
      ? Math.hypot(p.x, p.y, p.z)
      : null;
    visMain = isInViewFrustum(camera, portFrame) ? 1 : 0;
  }
  if (lastKeyAction) hud.setExtra(lastKeyAction);
  hud.updateWithPoses({
    robot,
    viewMode: `${window.VIEW_MODE} | FOCUS:${controlFocus}`,
    fps,
    ikOn: input.IK_ON,
    tcpPose,
    socketPose,
    relPose,
    camRelPose,
    distCam,
    visibleMain: visMain,
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

  // 비전 결과 오버레이 (좌 카메라 뷰포트에 바운딩박스 표시)
  if (lastDetections && stereo) {
    const ctx = ensureOverlay2d();
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    if (ctx.canvas.width !== w || ctx.canvas.height !== h) {
      ctx.canvas.width = w; ctx.canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);

    let vpX = 0, vpY = 0, vpW = w, vpH = h;
    if (window.VIEW_MODE === 'triple') {
      // 좌: 메인(80%), 우: 상단 L / 하단 R (20%)
      const leftW = Math.floor(w * 0.8);
      const rightW = w - leftW;
      const halfH = Math.floor(h / 2);
      // three.js viewport origin이 좌하단 → 2D 캔버스 좌상단으로 변환
      vpX = leftW;
      vpY = 0;           // 오른쪽 상단이 camL
      vpW = rightW;
      vpH = halfH;
    } else if (window.VIEW_MODE === 'stereo') {
      vpX = 0; vpY = 0; vpW = Math.floor(w / 2); vpH = h;
    } else {
      // single 뷰: 전체에 오버레이
      vpX = 0; vpY = 0; vpW = w; vpH = h;
    }

    const imgW = lastDetections.imgW || 640;
    const imgH = lastDetections.imgH || 480;
    const sx = vpW / imgW;
    const sy = vpH / imgH;

    ctx.strokeStyle = '#00ff55';
    ctx.lineWidth = 2;
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    for (const b of lastDetections.boxes || []) {
      const x1 = vpX + (b.x1 ?? 0) * sx;
      const y1 = vpY + (b.y1 ?? 0) * sy;
      const x2 = vpX + (b.x2 ?? 0) * sx;
      const y2 = vpY + (b.y2 ?? 0) * sy;
      const clsName = lastDetections.names ? lastDetections.names[b.cls] : b.cls;
      ctx.beginPath();
      ctx.rect(x1, y1, x2 - x1, y2 - y1);
      ctx.stroke();
      const label = `${clsName ?? '?'} ${(b.conf ?? 0).toFixed(2)}`;
      const tw = ctx.measureText(label).width + 6;
      ctx.fillRect(x1, y1 - 14, tw, 14);
      ctx.fillStyle = '#00ff55';
      ctx.fillText(label, x1 + 3, y1 - 3);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
    }
  } else if (overlay2d) {
    const ctx = overlay2d;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
