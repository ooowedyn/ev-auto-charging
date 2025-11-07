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

    this._bind();
  }
  _bind() {
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => this._onKeyUp(e));
  }
  _onKeyDown(e) {
    const step = 0.02,
      move = 0.03;
    if (e.code === 'Space') this.IK_ON = !this.IK_ON;
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
    if (e.code === 'KeyC') this.TEST_SWEEP.Motor5 = !this.TEST_SWEEP.Motor5;
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

    // view toggle (optional)
    if (e.code === 'KeyF') window.VIEW_MODE = window.VIEW_MODE === 'single' ? 'stereo' : 'single';
    if (e.code === 'KeyG') window.VIEW_MODE = 'triple';
  }
  _onKeyUp(e) {
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
  }
}
