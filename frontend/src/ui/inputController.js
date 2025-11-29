/**
 * InputController 키 매핑 정리
 *
 * 1) 모드/토글
 *  - Space: IK ON/OFF 토글
 *  - M: TEST_M1_SPIN 토글
 *  - N: TEST_M2_SWEEP 토글
 *  - B/V/X: Motor3/4/6 TEST_SWEEP 토글 (C는 Motor7 역방향 조그)
 *  - F: single ↔ stereo 뷰 토글
 *  - G: triple 뷰 고정
 *
 * 2) IK 타겟 이동
 *  - W/S: z-축 -, +
 *  - A/D: x-축 -, +
 *  - Q/E: y-축 -, +
 *
 * 3) 조인트 프리셋
 *  - 8/9/0: Motor1 0°, +45°, -45°
 *  - U/I/O: Motor2 0°, +45°, -45°
 *
 * 4) 조그(JOG) 제어
 *  - 1~6: Motor1~6 조그 (Shift와 함께 누르면 반대 방향)
 *  - Z: Motor7 조그
 */
// src/control/inputController.js
const RAD = (d) => (d * Math.PI) / 180;

export class InputController {
  constructor(robot, ikTarget) {
    this.robot = robot;
    this.ikTarget = ikTarget;
    this.HELD_JOG = {};
    this.JOG_STEP = 0.02;
    this.IK_ON = true;
    this.TEST_M1_SPIN = false;
    this.TEST_M2_SWEEP = false;
    this.TEST_SWEEP = { Motor3: false, Motor4: false, Motor5: false, Motor6: false };
    this.armControlEnabled = true;

    this._bind();
  }
  setArmControlEnabled(flag) {
    this.armControlEnabled = !!flag;
    if (!this.armControlEnabled) this.HELD_JOG = {};
  }
  _bind() {
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => this._onKeyUp(e));
  }
  _onKeyDown(e) {
    const step = 0.02,
      move = 0.03;
    if (e.code === 'Space') this.IK_ON = !this.IK_ON;
    // 뷰 토글은 포커스 무관하게 허용
    if (e.code === 'KeyF') window.VIEW_MODE = window.VIEW_MODE === 'single' ? 'stereo' : 'single';
    if (e.code === 'KeyG') window.VIEW_MODE = 'triple';
    // arm 제어 비활성 시 나머지 키 무시
    if (!this.armControlEnabled) return;
    if (e.code === 'KeyM') this.TEST_M1_SPIN = !this.TEST_M1_SPIN;
    if (e.code === 'KeyN') this.TEST_M2_SWEEP = !this.TEST_M2_SWEEP;

    if (e.code === 'Digit8') {
      this.robot.setJointAngle('Motor1', 0);
      this.robot.applyFK();
    }
    if (e.code === 'Digit9') {
      this.robot.setJointAngle('Motor1', RAD(45));
      this.robot.applyFK();
    }
    if (e.code === 'Digit0') {
      this.robot.setJointAngle('Motor1', RAD(-45));
      this.robot.applyFK();
    }

    if (e.code === 'KeyU') {
      this.robot.setJointAngle('Motor2', 0);
      this.robot.applyFK();
    }
    if (e.code === 'KeyI') {
      this.robot.setJointAngle('Motor2', RAD(45));
      this.robot.applyFK();
    }
    if (e.code === 'KeyO') {
      this.robot.setJointAngle('Motor2', RAD(-45));
      this.robot.applyFK();
    }

    if (e.code === 'KeyB') this.TEST_SWEEP.Motor3 = !this.TEST_SWEEP.Motor3;
    if (e.code === 'KeyV') this.TEST_SWEEP.Motor4 = !this.TEST_SWEEP.Motor4;
    if (e.code === 'KeyX') this.TEST_SWEEP.Motor6 = !this.TEST_SWEEP.Motor6;

    if (e.code === 'KeyW') this.ikTarget.position.z -= move;
    if (e.code === 'KeyS') this.ikTarget.position.z += move;
    if (e.code === 'KeyA') this.ikTarget.position.x -= move;
    if (e.code === 'KeyD') this.ikTarget.position.x += move;
    if (e.code === 'KeyQ') this.ikTarget.position.y -= move;
    if (e.code === 'KeyE') this.ikTarget.position.y += move;

    const JOG = {
      Digit1: 'Motor1',
      Digit2: 'Motor2',
      Digit3: 'Motor3',
      Digit4: 'Motor4',
      Digit5: 'Motor5',
      Digit6: 'Motor6',
      KeyZ: 'Motor7',
    };
    if (JOG[e.code]) this.HELD_JOG[JOG[e.code]] = e.shiftKey ? -1 : 1;
    if (e.code === 'KeyC') this.HELD_JOG['Motor7'] = -1; // Z가 정방향, C는 역방향

  }
  _onKeyUp(e) {
    if (!this.armControlEnabled) return;
    const JOG = {
      Digit1: 'Motor1',
      Digit2: 'Motor2',
      Digit3: 'Motor3',
      Digit4: 'Motor4',
      Digit5: 'Motor5',
      Digit6: 'Motor6',
      KeyZ: 'Motor7',
    };
    const name = JOG[e.code];
    if (name) delete this.HELD_JOG[name];
    if (e.code === 'KeyC') delete this.HELD_JOG['Motor7'];
  }
}
