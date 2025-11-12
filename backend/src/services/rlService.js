// control/main.py 호출 로직

import axios from 'axios';
import { logger } from '../utils/logger.js';

const RL_URL = process.env.RL_URL; // e.g. http://localhost:5002/rl/infer

export async function inferRL(payload) {
  if (!RL_URL) {
    // 모의 액션 (RL 서버 아직 미구현 시 사용)
    logger.warn('[rl] RL_URL not set. Returning mock action.');
    // 예: 6자유도 조인트에 대한 소량의 무작위 조정
    const action = { jointsDelta: [0, 0, 0, 0, 0, 0], ts: Date.now(), mock: true };
    return action;
  }

  const { data } = await axios.post(RL_URL, payload, { timeout: 10_000 });
  logger.info('[rl] response received');
  return data;
}
