/*
HUB : On-screen Debug Overlay
-----------------------------------------------------------------------------
역할:
  - 뷰 모드, FPS, 각 조인트 각도 등 텍스트 출력
  - setExtra(text)로 임시 진단 정보(오차/신뢰도 등) 표기

  주요 Export:
  - class HUD

자주 수정하는 지점:
  - 표기 포멧/정밀도. 항목 추가/순서 변경
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
  update(robot, viewMode = 'single', fpsStr = '') {
    const lines = [`[VIEW] ${viewMode} ${fpsStr}`, this.extra ? this.extra : ''];
    for (const n of Object.keys(robot.joints))
      if (robot.joints[n]) lines.push(`${n}: ${(((robot.angles[n] ?? 0) * 180) / Math.PI) | 0}°`);
    this.el.textContent = lines.filter(Boolean).join('\n');
  }
}
