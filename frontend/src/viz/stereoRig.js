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

    // 리그 전체의 기준점(root)
    this.root = new THREE.Object3D();
    this.root.position.set(0, 0, zOffset);

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
