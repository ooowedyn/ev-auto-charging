import path from 'path';
import { logger } from '../utils/logger.js';
import { inferB64 } from './pythonYoloWorker.js';

const ROOT = path.resolve(process.cwd(), '..'); // 프로젝트 루트 기준

function stripBase64Prefix(str = '') {
  return str.replace(/^data:.*;base64,/, '');
}

export async function processStereoFrame(payload = {}) {
  const { leftImageBase64, ts } = payload;
  if (!leftImageBase64) {
    throw new Error('stereo-frame payload must include leftImageBase64');
  }

  const frameId = ts || Date.now();
  const b64 = stripBase64Prefix(leftImageBase64);

  const result = await inferB64(b64);
  logger.info(`[vision] ${result?.boxes?.length ?? 0} boxes @ frame ${frameId}`);
  return { ...result, frameId };
}
