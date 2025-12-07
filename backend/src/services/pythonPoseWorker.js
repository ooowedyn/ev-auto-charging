import path from 'path';
import { spawn } from 'child_process';

const ROOT = path.resolve(process.cwd(), '..');
const SCRIPT_PATH = path.join(ROOT, 'vision', 'src', 'poseInfer.py');
const DEFAULT_WEIGHTS =
  process.env.POSE_WEIGHT_PATH ||
  path.join(ROOT, 'vision', 'SEGU', 'checkpoints', 'mobienetv3_scale100_epoch50_251207_012151', 'best.pth');

let worker = null;
let buffer = '';
const queue = [];

function startWorker() {
  worker = spawn('python3', [SCRIPT_PATH, '--weights', DEFAULT_WEIGHTS, '--stdin-loop'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  });

  worker.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      const item = queue.shift();
      if (!item) continue;
      try {
        const parsed = JSON.parse(line);
        item.resolve(parsed);
      } catch (err) {
        item.reject(err);
      }
    }
  });

  worker.stderr.on('data', (chunk) => {
    console.error('[pose-worker stderr]', chunk.toString());
  });

  worker.stdin.on('error', (err) => {
    // EPIPE 등으로 죽었을 때도 프로세스를 재시작할 수 있게만 로그 처리
    console.error('[pose-worker stdin error]', err.message);
  });

  worker.on('close', (code) => {
    console.warn(`[pose-worker] exited with code ${code}`);
    while (queue.length) {
      queue.shift().reject(new Error('pose worker exited'));
    }
    worker = null;
  });
}

function ensureWorker() {
  if (worker) return;
  startWorker();
}

export function inferPose(imageBase64) {
  ensureWorker();
  return new Promise((resolve, reject) => {
    queue.push({ resolve, reject });
    try {
      worker.stdin.write(JSON.stringify({ image: imageBase64 }) + '\n');
    } catch (err) {
      console.error('[pose-worker write error]', err.message);
      worker = null; // force restart on next call
      reject(err);
    }
  });
}
