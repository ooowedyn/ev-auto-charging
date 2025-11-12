// vision/main.py 호출 로직

import axios from 'axios';
import { logger } from '../utils/logger.js';

const VISION_URL = process.env.VISION_URL; // e.g. http://localhost:5001/infer

export async function inferVision(payload) {
  if (!VISION_URL) {
    // 모의 응답 (비전 서버 아직 미구현 시 사용)
    logger.warn('[vision] VISION_URL not set. Returning mock.');
    return {
      mock: true,
      detections: [],
      ellipse: [],
      ts: Date.now()
    };
  }

  const { data } = await axios.post(VISION_URL, payload, { timeout: 10_000 });
  logger.info('[vision] response received');
  return data;
}
