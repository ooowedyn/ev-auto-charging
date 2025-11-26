export class VisionPanel {
  constructor() {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed',
      'right:12px',
      'bottom:12px',
      'width:320px',
      'background:#0b0d12cc',
      'color:#dfe8f5',
      'border:1px solid #1c2533',
      'border-radius:8px',
      'padding:10px',
      'font:12px/1.4 monospace',
      'z-index:20',
      'backdrop-filter: blur(4px)',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'Stereo Vision Result';
    title.style.cssText = 'font-weight:bold;margin-bottom:6px;';
    this.root.appendChild(title);

    const previewsWrap = document.createElement('div');
    previewsWrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

    this.leftImg = document.createElement('img');
    this.leftImg.alt = 'Left detection';
    this.leftImg.style.cssText = 'width:155px;height:116px;object-fit:cover;border:1px solid #1f2735;border-radius:4px;background:#111318;';

    this.rightImg = document.createElement('img');
    this.rightImg.alt = 'Right detection';
    this.rightImg.style.cssText = 'width:155px;height:116px;object-fit:cover;border:1px solid #1f2735;border-radius:4px;background:#111318;';

    this.depthImg = document.createElement('img');
    this.depthImg.alt = 'Depth map';
    this.depthImg.style.cssText = 'width:155px;height:116px;object-fit:cover;border:1px solid #1f2735;border-radius:4px;background:#111318;';

    previewsWrap.appendChild(this.leftImg);
    previewsWrap.appendChild(this.rightImg);
    previewsWrap.appendChild(this.depthImg);
    this.root.appendChild(previewsWrap);

    this.meta = document.createElement('div');
    this.meta.style.cssText = 'margin-top:8px;white-space:pre-wrap;';
    this.meta.textContent = 'waiting for frames…';
    this.root.appendChild(this.meta);

    document.body.appendChild(this.root);
  }

  update(result) {
    if (!result) return;
    if (result.previews?.left) this.leftImg.src = result.previews.left;
    if (result.previews?.right) this.rightImg.src = result.previews.right;
    if (result.depthMap?.image) this.depthImg.src = result.depthMap.image;

    const lines = [];
    if (Array.isArray(result.boxes) && result.boxes.length > 0) {
      lines.push(`boxes (${result.boxes.length})`);
      for (const box of result.boxes) {
        const [x1, y1, x2, y2] = box.bbox || [];
        const depthStr = box.centerDepth == null ? '-' : box.centerDepth.toFixed(3);
        lines.push(
          `${box.side || '?'} cls${box.class} conf ${(box.confidence * 100).toFixed(1)}% depth ${depthStr}` +
          ` bbox [${x1?.toFixed?.(1)}, ${y1?.toFixed?.(1)}]-[${x2?.toFixed?.(1)}, ${y2?.toFixed?.(1)}]`
        );
      }
    } else {
      lines.push('no detections yet');
    }
    this.meta.textContent = lines.join('\n');
  }
}
