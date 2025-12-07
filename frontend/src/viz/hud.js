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
      'position:fixed;top:8px;right:8px;color:#e5eefc;font:12px/1.4 monospace;background:#0b0d12cc;padding:8px 10px;border-radius:6px;z-index:10;white-space:pre;';
    document.body.appendChild(this.el);
    this.extra = '';
  }
  setExtra(text) {
    this.extra = text || '';
  }
  updateWithPoses({
    robot,
    viewMode = 'single',
    fps = 0,
    ikOn = false,
    tcpPose,
    socketPose,
    relPose,
    camRelPose,
    distCam,
    visibleMain,
    poseInferOn = false,
    poseInfer = null,
  }) {
    const fmt = (n) => (Number.isFinite(n) ? n.toFixed(3) : 'nan');
    const lines = [`[VIEW] ${viewMode} | FPS ${fps.toFixed(0)} | IK:${ikOn ? 'ON' : 'OFF'}`];
    if (this.extra) lines.push(this.extra);
    lines.push(`[POSE INFER] ${poseInferOn ? 'ON' : 'OFF'}`);
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
    if (camRelPose) {
      const p = camRelPose.position || {};
      const q = camRelPose.quaternion || {};
      lines.push(
        `Cam->S pos(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}) quat(${fmt(q.x)}, ${fmt(q.y)}, ${fmt(q.z)}, ${fmt(q.w)}) dist:${fmt(distCam)} vis:${visibleMain ?? 'nan'}`
      );
    }
    if (poseInfer) {
      const gt = poseInfer.gt || {};
      const pr = poseInfer.pred || {};
      const er = poseInfer.err || {};
      const gtP = gt.position || {};
      const gtQ = gt.quaternion || {};
      const prP = pr.position || {};
      const prQ = pr.quaternion || {};
      const erP = er.position || {};
      const erQ = er.quaternion || {};
      lines.push(`GT  cam->sock p(${fmt(gtP.x)},${fmt(gtP.y)},${fmt(gtP.z)}) q(${fmt(gtQ.x)},${fmt(gtQ.y)},${fmt(gtQ.z)},${fmt(gtQ.w)})`);
      lines.push(`PRD cam->sock p(${fmt(prP.x)},${fmt(prP.y)},${fmt(prP.z)}) q(${fmt(prQ.x)},${fmt(prQ.y)},${fmt(prQ.z)},${fmt(prQ.w)})`);
      lines.push(`ERR           p(${fmt(erP.x)},${fmt(erP.y)},${fmt(erP.z)}) q(${fmt(erQ.x)},${fmt(erQ.y)},${fmt(erQ.z)},${fmt(erQ.w)})`);
      if (poseInfer.socketWorld || poseInfer.socketWorldPred) {
        const sw = poseInfer.socketWorld || {};
        const swp = poseInfer.socketWorldPred || {};
        const swP = sw.position || {};
        const swQ = sw.quaternion || {};
        const swpP = swp.position || {};
        const swpQ = swp.quaternion || {};
        lines.push(`SockW GT  p(${fmt(swP.x)},${fmt(swP.y)},${fmt(swP.z)}) q(${fmt(swQ.x)},${fmt(swQ.y)},${fmt(swQ.z)},${fmt(swQ.w)})`);
        lines.push(`SockW PRD p(${fmt(swpP.x)},${fmt(swpP.y)},${fmt(swpP.z)}) q(${fmt(swpQ.x)},${fmt(swpQ.y)},${fmt(swpQ.z)},${fmt(swpQ.w)})`);
      }
    }
    for (const n of Object.keys(robot.joints))
      if (robot.joints[n]) lines.push(`${n}: ${(((robot.angles[n] ?? 0) * 180) / Math.PI) | 0}°`);
    this.el.textContent = lines.filter(Boolean).join('\n');
  }
}
