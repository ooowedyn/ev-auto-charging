import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(process.cwd());
const STREAM_DIR = path.join(ROOT, 'vision', 'result', 'stream');
const SCRIPT_PATH = path.join(ROOT, 'vision', 'src', 'stream_infer.py');
const DEFAULT_WEIGHTS = process.env.YOLO_WEIGHT_PATH || path.join(ROOT, 'vision', 'weights', 'best.pt');
const DEFAULT_STEREO_JSON = process.env.STEREO_JSON_PATH || path.join(ROOT, 'vision', 'config', 'stereo_params.json');

function decodeDataUrl(dataUrl = '') {
  const matches = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  return Buffer.from(matches ? matches[2] : dataUrl, 'base64');
}

async function saveFrame(base64Str, outPath) {
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, decodeDataUrl(base64Str));
}

export async function processStereoFrame(payload = {}) {
  const { leftImageBase64, rightImageBase64, ts } = payload;
  if (!leftImageBase64 || !rightImageBase64) {
    throw new Error('stereo-frame payload must include leftImageBase64 and rightImageBase64');
  }

  const frameId = ts || Date.now();
  const outDir = path.join(STREAM_DIR, `${frameId}`);
  const leftPath = path.join(outDir, 'left.png');
  const rightPath = path.join(outDir, 'right.png');

  await saveFrame(leftImageBase64, leftPath);
  await saveFrame(rightImageBase64, rightPath);

  logger.info(`[vision] saved stereo frame ${frameId} → ${outDir}`);

  const args = [
    SCRIPT_PATH,
    '--left',
    leftPath,
    '--right',
    rightPath,
    '--weights',
    DEFAULT_WEIGHTS,
    '--stereo-json',
    DEFAULT_STEREO_JSON,
    '--out',
    outDir,
  ];

  const { stdout } = await execFileAsync('python3', args, { maxBuffer: 20 * 1024 * 1024 });
  const result = JSON.parse(stdout.trim());
  logger.info(`[vision] ${result?.boxes?.length ?? 0} boxes @ frame ${frameId}`);
  return { ...result, frameId };
}
