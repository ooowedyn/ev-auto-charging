/*
RobotArm: FK/IK & Joint State
-----------------------------------------------------------------------
역할:
    - GLTF에서 조인트 노드 찾기(별칭 NAME_MAP 사용)
    - 각 조인트 기본 자세 캐시, FK(회전 적용)
    - CCD 기반 IK(목표 점 추종), 엔드 이펙터 조회
    - GLTF 원래 계층 보존

주요 Export:
    - class RobotArm

자주 수정하는 지점:
    - IK 반복/허용오차(solveIK_CCD 파라미터)
    - 조인트 클램프/ 속도 제한 등 정책 추가 지점
*/

import * as THREE from 'three';
import { JOINT_ORDER, JOINT_META, NAME_MAP } from '../config/jointMeta';

function findJointNode(root, logicalName) {
  const aliases = NAME_MAP[logicalName] || [logicalName];
  const matches = [];
  root.traverse((o) => {
    const nm = o.name || '';
    if (aliases.some((a) => nm === a || nm.toLowerCase() === a.toLowerCase())) matches.push(o);
  });
  if (matches.length === 0) return null;
  // prefer non-mesh
  return matches.find((o) => !o.isMesh) || matches[0];
}

function depthFromRoot(node) {
  let d = 0,
    p = node;
  while (p) {
    d++;
    p = p.parent;
  }
  return d;
}

export class RobotArm {
  constructor(meta = JOINT_META, chainOrder = JOINT_ORDER) {
    this.meta = meta;
    this.order = [...chainOrder];
    this.joints = {}; // name -> Object3D
    this.angles = {}; // name -> radians
    this._defaults = {}; // name -> Quaternion
    this.root = null; // GLTF root
  }

  attach(root) {
    this.root = root;
    // resolve joints by alias map
    for (const n of JOINT_ORDER) this.joints[n] = findJointNode(root, n) || null;

    // chain sorted by scene depth (respect GLTF hierarchy!)
    const available = JOINT_ORDER.filter((n) => !!this.joints[n]).sort(
      (a, b) => depthFromRoot(this.joints[a]) - depthFromRoot(this.joints[b])
    );
    this.order.length = 0;
    this.order.push(...available);

    // cache defaults & reset
    for (const [name, node] of Object.entries(this.joints))
      if (node) this._defaults[name] = node.quaternion.clone();
    for (const n of this.order) this.angles[n] = 0;
    this.applyFK();
  }

  setJointAngle(name, rad) {
    const node = this.joints[name];
    if (!node) return;
    const meta = this.meta[name] || {};
    const clamped = THREE.MathUtils.clamp(rad, meta.min ?? -Infinity, meta.max ?? Infinity);
    this.angles[name] = clamped;
    node.quaternion.copy(this._defaults[name]);
    const axis = (meta.axis ?? new THREE.Vector3(0, 0, 1)).clone().normalize();
    node.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, clamped));
  }

  applyFK() {
    for (const n of this.order) this.setJointAngle(n, this.angles[n] ?? 0);
  }

  getEndEffector() {
    for (let i = this.order.length - 1; i >= 0; --i) {
      const n = this.order[i];
      if (this.joints[n]) return this.joints[n];
    }
    return null;
  }

  solveIK_CCD(target, iterations = 10, tol = 1e-3) {
    const ee = this.getEndEffector();
    if (!ee) return;
    const targetWorld =
      target instanceof THREE.Vector3 ? target.clone() : new THREE.Vector3().copy(target.position);
    const tmp = new THREE.Vector3();

    for (let it = 0; it < iterations; it++) {
      let solved = false;
      for (let i = this.order.length - 1; i >= 0; i--) {
        const name = this.order[i],
          j = this.joints[name];
        if (!j) continue;

        const jw = j.getWorldPosition(new THREE.Vector3());
        const ew = ee.getWorldPosition(new THREE.Vector3());
        const v1 = ew.clone().sub(jw);
        const v2 = targetWorld.clone().sub(jw);
        if (v1.lengthSq() < 1e-10 || v2.lengthSq() < 1e-10) continue;
        v1.normalize();
        v2.normalize();

        const localAxis = (this.meta[name]?.axis.clone() ?? new THREE.Vector3(0, 0, 1)).normalize();
        const worldQuat = j.getWorldQuaternion(new THREE.Quaternion());
        const worldAxis = localAxis.applyQuaternion(worldQuat).normalize();

        const cross = new THREE.Vector3().crossVectors(v1, v2);
        const sin = THREE.MathUtils.clamp(cross.dot(worldAxis), -1, 1);
        const cos = THREE.MathUtils.clamp(v1.dot(v2), -1, 1);
        const delta = Math.atan2(sin, cos);

        this.setJointAngle(name, (this.angles[name] ?? 0) + delta);
        this.applyFK();

        const dist = ee.getWorldPosition(tmp).distanceTo(targetWorld);
        if (dist < tol) {
          solved = true;
          break;
        }
      }
      if (solved) break;
    }
  }
}
