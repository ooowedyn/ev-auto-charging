// backend/src/sockets/wsHandler.js
import WebSocket, { WebSocketServer } from 'ws';
import { processStereoFrame } from '../services/stereoVisionService.js';

export function initWebSocket(server) {
  const wss = new WebSocketServer({ server });

  function broadcast(obj, except = null) {
    const msg = JSON.stringify(obj);
    wss.clients.forEach((client) => {
      if (client !== except && client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`🌐 Client connected: ${ip}`);
    ws.send(JSON.stringify({ type: 'hello', data: 'Connected to WebSocket Server' }));

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch {
        console.error('[WS] Invalid JSON'); return;
      }
      const { type, data } = msg || {};
      switch (type) {
        case 'pose-update':
          console.log('[WS] Pose update:', data);
          // 필요 시 다른 클라이언트(관제 화면 등)로 중계
          broadcast({ type: 'pose-update', data }, ws);
          ws.send(JSON.stringify({ type: 'ack', data: { received: 'pose-update' } }));
          break;

        case 'camera-frame':
          // 여기서는 로그만, 필요하면 파일 저장/비전파이프라인으로 전달
          console.log('[WS] Camera frame received');
          ws.send(JSON.stringify({ type: 'ack', data: { received: 'camera-frame' } }));
          break;

        case 'stereo-frame':
          console.log('[WS] stereo frame received');
          try {
            const result = await processStereoFrame(data);
            ws.send(JSON.stringify({ type: 'vision-result', data: result }));
            broadcast({ type: 'vision-result', data: result }, ws);
          } catch (err) {
            console.error('[WS] stereo-frame error', err.message);
            ws.send(JSON.stringify({ type: 'error', data: { reason: 'stereo-frame-failed', message: err.message } }));
          }
          break;

        case 'action-cmd':
          console.log('[WS] Action command:', data);
          // 필요 시 RL 서비스로 전달 후 결과 받아 다시 rl-action 브로드캐스트
          // 예: broadcast({ type: 'rl-action', data: ... });
          ws.send(JSON.stringify({ type: 'ack', data: { received: 'action-cmd' } }));
          break;

        // (선택) RL 서비스가 서버로 액션을 push할 때 사용할 엔드포인트
        case 'rl-action':
          console.log('[WS] RL action (broadcast):', data);
          broadcast({ type: 'rl-action', data }, ws);
          ws.send(JSON.stringify({ type: 'ack', data: { received: 'rl-action' } }));
          break;

        case 'request-frame':
          // 특정 프론트에 프레임을 요청하거나 전체에 요청 가능
          broadcast({ type: 'request-frame', data }, ws);
          break;

        default:
          console.log('[WS] Unknown type:', type);
          ws.send(JSON.stringify({ type: 'error', data: { reason: 'unknown-type', type } }));
      }
    });

    ws.on('close', () => console.log(`❌ Client disconnected: ${ip}`));
  });

  console.log('✅ WebSocket server initialized');
}
