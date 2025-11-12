import * as THREE from 'three';

export class StereoRig {
  constructor({
    fov = 60,
    width = 640,
    height = 480,
    baseline = 0.06,
    near = 0.01,
    far = 10,
    zOffset = 0.15, // 엔드이펙터 앞쪽으로 얼마나 튀어나오게 할지
  }) {
    this.width = width;
    this.height = height;
    this.fov = fov;
    this.baseline = baseline;

    // 실제 카메라들
    this.camL = new THREE.PerspectiveCamera(fov, width / height, near, far);
    this.camR = new THREE.PerspectiveCamera(fov, width / height, near, far);

    // 왼/오 위치를 위한 노드
    this.left = new THREE.Object3D();
    this.right = new THREE.Object3D();
    this.left.position.set(-baseline / 2, 0, 0);
    this.right.position.set(baseline / 2, 0, 0);
    this.left.add(this.camL);
    this.right.add(this.camR);

    // 👇 NEW: 리그 전체의 기준점(root)
    // 엔드이펙터 팁에서 조금 앞으로 밀고 싶으면 여기서 제어
    this.root = new THREE.Object3D();
    this.root.position.set(0, 0, zOffset);
    // 방향(roll/pitch/yaw)도 여기서 맞출 수 있음. 필요하면 회전도 줄 수 있어.
    // 예: this.root.rotation.set(Math.PI, 0, 0);

    this.root.add(this.left);
    this.root.add(this.right);
  }

  attachTo(eeNode) {
    eeNode.add(this.root);
  }

  intrinsics() {
    const fy = (0.5 * this.height) / Math.tan(THREE.MathUtils.degToRad(this.fov / 2));
    const fx = fy;
    const cx = this.width / 2;
    const cy = this.height / 2;
    return { fx, fy, cx, cy };
  }
}

export function getStereoParams(rig) {
  return {
    fov: rig.fov,
    width: rig.width,
    height: rig.height,
    baseline: rig.baseline,
    intrinsics: rig.intrinsics()
  };
}

export function getExtrinsics(rig) {
  rig.camL.updateMatrixWorld();
  rig.camR.updateMatrixWorld();

  const L = rig.camL.matrixWorld.elements;
  const R = rig.camR.matrixWorld.elements;

  return {
    left: { matrixWorld: L },
    right: { matrixWorld: R }
  };
}