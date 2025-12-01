// WebSocket 연결// frontend/src/network/socketClient.js
export class SocketClient {
  constructor(url = 'ws://localhost:3000') {
    this.url = url;
    this.ws = null;
    this.handlers = {};
    this.connected = false;

    // 프레임 스트리밍
    this._streamTimer = null;
    this._streamFps = 5;
    this._getFrame = null; // () => base64 string

    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.connected = true;
      console.log('[WS] Connected to server');
    };
    this.ws.onclose = () => {
      this.connected = false;
      console.log('[WS] Disconnected');
    };
    this.ws.onerror = (err) => console.error('[WS] Error', err);
    this.ws.onmessage = (event) => this._handleMessage(event);
  }

  _handleMessage(event) {
    try {
      const msg = JSON.parse(event.data);
      // 디버깅 출력
      console.log('[WS recv]', msg);
      const cb = this.handlers[msg.type];
      if (cb) cb(msg.data);

      // 서버가 프레임을 요청할 수도 있음
      if (msg.type === 'request-frame' && this._getFrame) {
        const fps = (msg.data && msg.data.fps) || this._streamFps;
        this.startFrameStreaming(this._getFrame, fps);
      }
      // frame 저장 ACK 처리
      if (msg.type === 'ack' && msg.data?.received === 'frame') {
        const paths = msg.data?.paths || {};
        const left = paths.leftPath || '';
        const right = paths.rightPath || '';
        const fallback = msg.data?.path || '';
        console.log(`[WS] frame saved: L=${left || 'unknown'} R=${right || 'unknown'} ${fallback && `(${fallback})`}`);
      }
    } catch (err) {
      console.error('[WS] Invalid message:', event.data);
    }
  }

  on(type, callback) { this.handlers[type] = callback; }

  send(type, data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    } else {
      console.warn('[WS] Not connected, cannot send:', type);
    }
  }

  // ── 프레임 스트리밍 ─────────────────────────────────────────
  /**
   * @param {() => string} getFrame  renderer.domElement.toDataURL(...)를 반환하는 함수
   * @param {number} fps            초당 전송 프레임 수
   */
  startFrameStreaming(getFrame, fps = 5) {
    this._getFrame = getFrame;
    this._streamFps = fps;
    this.stopFrameStreaming();
    const interval = 1000 / Math.max(1, fps);
    this._streamTimer = setInterval(() => {
      try {
        const imageBase64 = getFrame();
        if (imageBase64) this.send('camera-frame', { imageBase64 });
      } catch (e) {
        console.error('[WS] frame capture error', e);
      }
    }, interval);
    console.log(`[WS] frame streaming started @ ${fps} fps`);
  }

  stopFrameStreaming() {
    if (this._streamTimer) {
      clearInterval(this._streamTimer);
      this._streamTimer = null;
      console.log('[WS] frame streaming stopped');
    }
  }
}
