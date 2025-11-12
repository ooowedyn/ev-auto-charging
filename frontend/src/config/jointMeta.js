/*
Joint Configuration (Order / Axes / Name Aliases)

역할: 
  - JOINT_ORDER: 베이스->툴 조인트 순서
  - JOINT_META: 각 조인트 로컬 회전축 벡터/리밋
  - NAME_MAP: GLTF 실제 노드명 별칭 목록(조인트 탐색용)

주요 Export:
  - JOINT_ORDER, JOINT_META, NAME_MAP

자주 수정하는 지점:
  - NAME_MAP에 실제 GLTF 노드명 추가/수정
  - JOINT_META.axis 부호/축 정합(헬퍼 보며 조정)
*/

import * as THREE from 'three';

export const JOINT_ORDER = ['Motor1', 'Motor2', 'Motor3', 'Motor4', 'Motor5', 'Motor6', 'Motor7'];

export const JOINT_META = {
  Motor1: { axis: new THREE.Vector3(0, 0, 1), min: -Infinity, max: Infinity },
  Motor2: { axis: new THREE.Vector3(0, 1, 0), min: -Infinity, max: Infinity },
  Motor3: { axis: new THREE.Vector3(0, 0, 1), min: -Infinity, max: Infinity },
  Motor4: { axis: new THREE.Vector3(0, 1, 0), min: -Infinity, max: Infinity },
  Motor5: { axis: new THREE.Vector3(0, 0, 1), min: -Infinity, max: Infinity },
  Motor6: { axis: new THREE.Vector3(0, 1, 0), min: -Infinity, max: Infinity },
  Motor7: { axis: new THREE.Vector3(0, 0, 1), min: -Infinity, max: Infinity },
};

// GLTF 실제 노드명 별칭(필요시 여기에 실제 이름 추가)
export const NAME_MAP = {
  Motor1: ['Motor1', 'Joint1', 'Base', 'Shoulder'],
  Motor2: ['Motor2', 'Joint2', 'Shoulder_2'],
  Motor3: ['Motor3', 'Joint3', 'Elbow'],
  Motor4: ['Motor4', 'Joint4', 'Wrist1'],
  Motor5: ['Motor5', 'Joint5', 'Wrist2'],
  Motor6: ['Motor6', 'Joint6', 'Wrist3'],
  Motor7: ['Motor7', 'Joint7', 'Flange', 'Tool', 'TCP', 'EE_Tip'],
};
