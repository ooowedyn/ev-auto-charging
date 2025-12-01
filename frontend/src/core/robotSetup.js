import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RobotArm } from './robotArm.js';
import { RobotController } from './robotController.js';
import { InputController } from '../ui/inputController.js';
import { StereoRig } from '../viz/stereoRig.js';
import { JOINT_ORDER } from '../config/jointMeta.js';

const LIMITS_KEY = 'jointLimits';

function loadJointLimits() {
  const limits = {};
  try {
    const raw = localStorage.getItem(LIMITS_KEY);
    if (!raw) return limits;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === 'object') limits[k] = { min: v.min, max: v.max };
      }
    }
  } catch {
    /* noop */
  }
  return limits;
}

function saveJointLimits(limits) {
  try {
    localStorage.setItem(LIMITS_KEY, JSON.stringify(limits));
  } catch {
    /* noop */
  }
}

export function initRobotSystem({ scene, camera, dir }) {
  const jointLimits = loadJointLimits();
  const jointUI = [];

  const robot = new RobotArm();
  const controller = new RobotController(robot);

  // IK target (노랑 삼각뿔)
  const ikTarget = new THREE.Mesh(
    new THREE.ConeGeometry(0.03, 0.08, 4),
    new THREE.MeshStandardMaterial({ color: 0xffcc00, metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.8 })
  );
  ikTarget.rotation.x = -Math.PI / 2; // -Z 방향을 가리키도록
  ikTarget.position.set(0.4, 0.9, 0.3);
  ikTarget.visible = true;
  ikTarget.name = 'IK_TARGET';
  scene.add(ikTarget);

  const input = new InputController(robot, ikTarget);
  input.IK_ON = true;

  // clamp setJointAngle with limits
  const _origSetJoint = robot.setJointAngle.bind(robot);
  robot.setJointAngle = (name, rad) => {
    const lim = jointLimits[name];
    if (lim && (lim.min != null || lim.max != null)) {
      const deg = THREE.MathUtils.radToDeg(rad);
      let clampedDeg = deg;
      if (lim.min != null) clampedDeg = Math.max(clampedDeg, lim.min);
      if (lim.max != null) clampedDeg = Math.min(clampedDeg, lim.max);
      rad = THREE.MathUtils.degToRad(clampedDeg);
    }
    return _origSetJoint(name, rad);
  };

  function moveIkTargetLocal(dx, dy, dz) {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd).normalize();
    const up = camera.up.clone().normalize();
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    if (Number.isFinite(dx)) ikTarget.position.addScaledVector(right, dx);
    if (Number.isFinite(dy)) ikTarget.position.addScaledVector(up, dy);
    if (Number.isFinite(dz)) ikTarget.position.addScaledVector(fwd, dz);
  }

  function createJointPanel() {
    const panel = document.createElement('div');
    panel.style.cssText =
      'position:fixed;bottom:10px;left:50%;transform:translateX(-50%);background:#0b0d12cc;color:#e5eefc;padding:8px;border-radius:6px;font:12px monospace;z-index:20;max-height:40vh;overflow:auto;';
    panel.innerHTML = '<div style="margin-bottom:4px;font-weight:bold;text-align:center;">Joint Control</div>';
    const toDeg = (r) => (((r || 0) * 180) / Math.PI).toFixed(0);
    const toRad = (d) => (d * Math.PI) / 180;
    JOINT_ORDER.forEach((name) => {
      if (!robot.joints[name]) return;
      const limits = jointLimits[name] || {};
      const row = document.createElement('div');
      row.style.marginBottom = '4px';
      const label = document.createElement('span');
      label.textContent = `${name}`;
      label.style.display = 'inline-block';
      label.style.width = '70px';
      const valueSpan = document.createElement('span');
      valueSpan.style.marginLeft = '6px';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '-360';
      slider.max = '360';
      slider.step = '1';
      slider.value = toDeg(robot.angles[name]);
      valueSpan.textContent = `${slider.value}°`;
      const minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.style.width = '60px';
      minInput.placeholder = 'min';
      if (limits.min != null) minInput.value = limits.min;
      const maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.style.width = '60px';
      maxInput.placeholder = 'max';
      if (limits.max != null) maxInput.value = limits.max;

      const applyAngle = (deg) => {
        const lim = jointLimits[name] || {};
        let clamped = deg;
        if (lim.min != null) clamped = Math.max(clamped, lim.min);
        if (lim.max != null) clamped = Math.min(clamped, lim.max);
        const show = clamped.toFixed(0);
        slider.value = show;
        valueSpan.textContent = `${show}°`;
        robot.setJointAngle(name, toRad(clamped));
        robot.applyFK();
      };

      slider.addEventListener('input', () => {
        const deg = parseFloat(slider.value) || 0;
        applyAngle(deg);
      });
      const onLimitChange = () => {
        const min = parseFloat(minInput.value);
        const max = parseFloat(maxInput.value);
        jointLimits[name] = { min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null };
        saveJointLimits(jointLimits);
        applyAngle(parseFloat(slider.value) || 0);
      };
      minInput.addEventListener('change', onLimitChange);
      maxInput.addEventListener('change', onLimitChange);
      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(valueSpan);
      row.appendChild(minInput);
      row.appendChild(maxInput);
      panel.appendChild(row);

      jointUI.push({ name, slider, valueSpan });
    });
    document.body.appendChild(panel);
  }

  function syncJointUI() {
    jointUI.forEach(({ name, slider, valueSpan }) => {
      if (!robot.joints[name]) return;
      const deg = THREE.MathUtils.radToDeg(robot.angles[name] ?? 0);
      const show = deg.toFixed(0);
      slider.value = show;
      valueSpan.textContent = `${show}°`;
    });
  }

  // 로봇/리그 로드 (비동기)
  const loader = new GLTFLoader();
  const loadPromise = new Promise((resolve, reject) => {
    loader.load(
      '/untitled.glb',
      (gltf) => {
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
        const RAD = (deg) => (deg * Math.PI) / 180;
        const initialAngles = {
          Motor1: RAD(0),
          Motor2: RAD(-12),
          Motor3: RAD(225),
          Motor4: RAD(38),
          Motor5: RAD(213),
          Motor6: RAD(364),
          Motor7: RAD(380),
        };
        for (const [name, angle] of Object.entries(initialAngles)) {
          if (robot.joints[name]) robot.setJointAngle(name, angle);
        }
        robot.applyFK();
        createJointPanel();

        // EE tip mount + stereo + PlugFrame
        let plugFrame = null;
        let plugMarker = null;
        let stereo = null;
        let plugCam = null;
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
          // IK end-effector를 플러그 프레임으로 설정하여 IK 타깃이 빨간 삼각뿔 위치에 정렬되도록
          robot.setEndEffector(plugFrame);

          // Tip mount 시각화(초록 삼각뿔)
          const tipViz = new THREE.Mesh(
            new THREE.ConeGeometry(0.025, 0.06, 4),
            new THREE.MeshStandardMaterial({ color: 0x00ff99, metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.5 })
          );
          tipViz.rotation.x = -Math.PI / 2;
          tipViz.name = 'TipViz';
          tipMount.add(tipViz);

          // TCP 시각화(빨강 삼각뿔)
          const tcpViz = new THREE.Mesh(
            new THREE.ConeGeometry(0.02, 0.05, 4),
            new THREE.MeshStandardMaterial({ color: 0xff3333, metalness: 0.2, roughness: 0.4, transparent: true, opacity: 0.8 })
          );
          tcpViz.rotation.x = -Math.PI / 2;
          tcpViz.name = 'TCPViz';
          plugFrame.add(tcpViz);

          stereo = new StereoRig({ fov: 60, width: 640, height: 480, baseline: 0.06, near: 0.01, far: 20, zOffset: 0.0 });
          stereo.attachTo(tipMount);

          // 🔦 EE 말단 핀조명 (스테레오 카메라 사이에 장착)
          const pinLight = new THREE.SpotLight(0xffffff, 0.6, 1.8, Math.PI / 6, 0.4, 1.0);
          pinLight.name = 'EE_PinLight';
          pinLight.castShadow = true;
          pinLight.position.set(0, 0, 0.02);
          const pinTarget = new THREE.Object3D();
          pinTarget.position.set(0, 0, -1);
          tipMount.add(pinTarget);
          pinLight.target = pinTarget;
          tipMount.add(pinLight);

          const markerGeom = new THREE.SphereGeometry(0.015, 16, 16);
          const markerMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
          plugMarker = new THREE.Mesh(markerGeom, markerMat);
          plugMarker.name = 'PlugMarker';
          scene.add(plugMarker);

          // EE 전용 카메라 (plugFrame 기준, -Z를 바라보는 보조 시야)
          plugCam = new THREE.PerspectiveCamera(70, 4 / 3, 0.01, 10);
          plugCam.position.set(0, 0, 0.05); // 플러그 프레임 뒤쪽에서 바라보게 오프셋
          plugCam.lookAt(0, 0, -1);
          plugFrame.add(plugCam);
        }

        resolve({ plugFrame, stereo, plugMarker, plugCam });
      },
      undefined,
      (err) => reject(err)
    );
  });

  return {
    robot,
    controller,
    input,
    ikTarget,
    moveIkTargetLocal,
    syncJointUI,
    loadPromise: loadPromise,
  };
}
