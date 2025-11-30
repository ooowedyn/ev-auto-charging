// backend/src/sockets/wsHandler.js
import WebSocket, { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { processStereoFrame } from '../services/stereoVisionService.js';

// 기본 저장 경로: 프로젝트/vision/dataset/raw/images (left/right 하위 폴더)
// 필요 시 DATASET_ROOT 환경변수로 오버라이드
const DATASET_ROOT =
  process.env.DATASET_ROOT ||
  path.resolve(process.cwd(), '..', 'vision', 'dataset', 'raw', 'images');
const LABEL_PATH =
  process.env.LABEL_PATH ||
  path.resolve(process.cwd(), '..', 'vision', 'dataset', 'raw', 'labels.csv');
const FRAME_DIR_LEFT = path.join(DATASET_ROOT, 'left');
const FRAME_DIR_RIGHT = path.join(DATASET_ROOT, 'right');

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

function stripBase64Prefix(str = '') {
  return str.replace(/^data:.*;base64,/, '');
}

function encodeNumber(num, digits = 3) {
  const n = Number(num);
  if (!Number.isFinite(n)) return 'nan';
  return n.toFixed(digits).replace(/-/g, 'm').replace(/\./g, 'd');
}

function formatTsYYMMDDhhmmss(ts) {
  // 단순히 제공된 ts를 날짜로 변환하거나, 문자열(12자리)이면 그대로 사용
  if (typeof ts === 'string' && ts.length === 12) return ts;
  const d = ts ? new Date(ts) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    String(d.getFullYear()).slice(-2) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function buildFilename(side, dist, ts, relPose, visible) {
  const timestamp = formatTsYYMMDDhhmmss(ts ?? Date.now());
  const { position = {}, quaternion = {} } = relPose || {};
  const p = [
    encodeNumber(position.x ?? position[0]),
    encodeNumber(position.y ?? position[1]),
    encodeNumber(position.z ?? position[2]),
  ];
  const q = [
    encodeNumber(quaternion.x ?? quaternion[0]),
    encodeNumber(quaternion.y ?? quaternion[1]),
    encodeNumber(quaternion.z ?? quaternion[2]),
    encodeNumber(quaternion.w ?? quaternion[3]),
  ];
  const distStr = encodeNumber(dist ?? 0);
  const visStr = visible != null ? String(visible) : 'nan';
  // order: side, timestamp, pose, distance, visible
  return `${side}_${timestamp}_${p.join('_')}_${q.join('_')}_${distStr}_${visStr}.png`;
}

async function appendCsvRow(rowArr) {
  const header = [
    'id','side',
    'tx','ty','tz','qx','qy','qz','qw',
    'j1','j2','j3','j4','j5','j6','j7',
    'cam_tx','cam_ty','cam_tz','cam_qx','cam_qy','cam_qz','cam_qw',
    'tcp_w_tx','tcp_w_ty','tcp_w_tz','tcp_w_qx','tcp_w_qy','tcp_w_qz','tcp_w_qw',
    'socket_w_tx','socket_w_ty','socket_w_tz','socket_w_qx','socket_w_qy','socket_w_qz','socket_w_qw',
    'dist_tcp_socket','visible'
  ];
  const line = rowArr.join(',') + '\n';
  const exists = fs.existsSync(LABEL_PATH);
  await ensureDir(path.dirname(LABEL_PATH));
  if (!exists) await fs.promises.writeFile(LABEL_PATH, header.join(',') + '\n');
  await fs.promises.appendFile(LABEL_PATH, line);
}

async function saveFramePacket(packet = {}) {
  const {
    image,
    tcpToSocketPose,
    tcpPoseWorld,
    socketPoseWorld,
    dist,
    visible,
    joints = [],
    camPose = {},
    timestamp,
  } = packet;
  if (!image?.left || !image?.right) throw new Error('frame packet missing image.left/right');
  const ts = formatTsYYMMDDhhmmss(timestamp ?? Date.now());

  await ensureDir(FRAME_DIR_LEFT);
  await ensureDir(FRAME_DIR_RIGHT);

  const saveSide = async (side, img, camPoseSide, visibleVal) => {
    const filename = buildFilename(side[0], dist, ts, tcpToSocketPose, visibleVal);
    const outDir = side === 'left' ? FRAME_DIR_LEFT : FRAME_DIR_RIGHT;
    const outPath = path.join(outDir, filename);
    const buf = Buffer.from(stripBase64Prefix(img.data), 'base64');
    await fs.promises.writeFile(outPath, buf);

    const pose = tcpToSocketPose || {};
    const pos = pose.position || {};
    const quat = pose.quaternion || {};
    const camPos = camPoseSide?.position || {};
    const camQuat = camPoseSide?.quaternion || {};
    const tcpWPos = tcpPoseWorld?.position || {};
    const tcpWQuat = tcpPoseWorld?.quaternion || {};
    const socketWPos = socketPoseWorld?.position || {};
    const socketWQuat = socketPoseWorld?.quaternion || {};
    const js = joints || [];
    const row = [
      ts,
      side === 'left' ? 'l' : 'r',
      pos.x ?? '', pos.y ?? '', pos.z ?? '',
      quat.x ?? '', quat.y ?? '', quat.z ?? '', quat.w ?? '',
      js[0] ?? '', js[1] ?? '', js[2] ?? '', js[3] ?? '', js[4] ?? '', js[5] ?? '', js[6] ?? '',
      camPos.x ?? '', camPos.y ?? '', camPos.z ?? '',
      camQuat.x ?? '', camQuat.y ?? '', camQuat.z ?? '', camQuat.w ?? '',
      tcpWPos.x ?? '', tcpWPos.y ?? '', tcpWPos.z ?? '',
      tcpWQuat.x ?? '', tcpWQuat.y ?? '', tcpWQuat.z ?? '', tcpWQuat.w ?? '',
      socketWPos.x ?? '', socketWPos.y ?? '', socketWPos.z ?? '',
      socketWQuat.x ?? '', socketWQuat.y ?? '', socketWQuat.z ?? '', socketWQuat.w ?? '',
      dist ?? '', visibleVal ?? '',
    ];
    await appendCsvRow(row);
    return outPath;
  };

  const leftPath = await saveSide('left', image.left, camPose.left, visible?.left);
  const rightPath = await saveSide('right', image.right, camPose.right, visible?.right);
  return { leftPath, rightPath };
}

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

        case 'frame':
          try {
            const saved = await saveFramePacket(data);
            console.log(`[WS] frame saved:`, saved);
            ws.send(JSON.stringify({ type: 'ack', data: { received: 'frame', paths: saved } }));
          } catch (err) {
            console.error('[WS] frame save error', err.message);
            ws.send(JSON.stringify({ type: 'error', data: { reason: 'frame-save-failed', message: err.message } }));
          }
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
