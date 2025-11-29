/*
HUD : On-screen Debug Overlay
-----------------------------------------------------------------------------
역할:
  - 뷰 모드, FPS, 각 조인트 각도 및 포즈 정보를 텍스트로 출력
  - setExtra(text)로 임시 진단 정보 표기

  주요 Export:
  - class HUD
*/
export class HUD {
  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;top:8px;left:8px;color:#e5eefc;font:12px/1.4 monospace;background:#0b0d12cc;padding:8px 10px;border-radius:6px;z-index:10;white-space:pre;';
    document.body.appendChild(this.el);
    this.extra = '';
  }
  setExtra(text) {
    this.extra = text || '';
  }
  updateWithPoses({ robot, viewMode = 'single', fps = 0, ikOn = false, tcpPose, socketPose, relPose }) {
    const fmt = (n) => (Number.isFinite(n) ? n.toFixed(3) : 'nan');
    const lines = [`[VIEW] ${viewMode} | FPS ${fps.toFixed(0)} | IK:${ikOn ? 'ON' : 'OFF'}`];
    if (this.extra) lines.push(this.extra);
    if (tcpPose) {
      const p = tcpPose.position || {};
      const q = tcpPose.quaternion || {};
      lines.push(`TCP   pos(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}) quat(${fmt(q.x)}, ${fmt(q.y)}, ${fmt(q.z)}, ${fmt(q.w)})`);
    }
    if (socketPose) {
      const p = socketPose.position || {};
      const q = socketPose.quaternion || {};
      lines.push(`Sock  pos(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}) quat(${fmt(q.x)}, ${fmt(q.y)}, ${fmt(q.z)}, ${fmt(q.w)})`);
    }
    if (relPose) {
      const p = relPose.position || {};
      const q = relPose.quaternion || {};
      lines.push(`TCP->S pos(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}) quat(${fmt(q.x)}, ${fmt(q.y)}, ${fmt(q.z)}, ${fmt(q.w)})`);
    }
    for (const n of Object.keys(robot.joints))
      if (robot.joints[n]) lines.push(`${n}: ${(((robot.angles[n] ?? 0) * 180) / Math.PI) | 0}°`);
    this.el.textContent = lines.filter(Boolean).join('\n');
  }
}
