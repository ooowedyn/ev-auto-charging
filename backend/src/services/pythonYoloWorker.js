import path from 'path';
import { spawn } from 'child_process';

const ROOT = path.resolve(process.cwd(), '..');
const SCRIPT_PATH = path.join(ROOT, 'vision', 'src', 'stream_infer.py');
const DEFAULT_WEIGHTS = process.env.YOLO_WEIGHT_PATH || path.join(ROOT, 'vision', 'weights', 'best.pt');

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
    console.error('[yolo-worker stderr]', chunk.toString());
  });

  worker.on('close', (code) => {
    console.warn(`[yolo-worker] exited with code ${code}`);
    // reject pending
    while (queue.length) {
      queue.shift().reject(new Error('worker exited'));
    }
    worker = null;
  });
}

export function inferB64(imageBase64) {
  if (!worker) startWorker();
  return new Promise((resolve, reject) => {
    queue.push({ resolve, reject });
    worker.stdin.write(JSON.stringify({ image: imageBase64 }) + '\n');
  });
}
