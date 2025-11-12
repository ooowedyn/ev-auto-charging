//  # IK, FK 등 로직 래퍼

export class RobotController {
  constructor(robot) { this.robot = robot; }

  applyIK(targetPos) { this.robot.solveIK_CCD(targetPos, 32, 1e-3); }

  applyWristControl(errors) {
    const { droll, dpitch, dyaw } = errors;
    const KP = 0.5, MAX = 0.02;
    const clamp = (x) => Math.max(-MAX, Math.min(MAX, x));

    const deltas = {
      Motor5: clamp(-KP * dpitch),
      Motor6: clamp(-KP * dyaw),
      Motor7: clamp(-KP * droll),
    };
    Object.entries(deltas).forEach(([joint, delta]) => {
      if (!this.robot.joints[joint]) return;
      const cur = this.robot.angles[joint] ?? 0;
      this.robot.setJointAngle(joint, cur + delta);
    });
  }

  // ✅ RL 액션 직접 적용용
  applyRLAction(data) {
    // 예시1) data = { mode: 'wrist-rpy-delta', delta: { droll, dpitch, dyaw } }
    if (data?.mode === 'wrist-rpy-delta' && data.delta) {
      return this.applyWristControl(data.delta);
    }
    // 예시2) data = { mode:'joint-delta', delta:{ Motor1:0.01, Motor2:-0.02, ... } }
    if (data?.mode === 'joint-delta' && data.delta) {
      const MAX = 0.03;
      Object.entries(data.delta).forEach(([name, d]) => {
        if (!this.robot.joints[name]) return;
        const cur = this.robot.angles[name] ?? 0;
        const delta = Math.max(-MAX, Math.min(MAX, d));
        this.robot.setJointAngle(name, cur + delta);
      });
      return;
    }
  }
}