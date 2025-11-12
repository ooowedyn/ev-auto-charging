// 로봇 상태 및 제어 요청

import { Router } from 'express';
import { logger } from '../utils/logger.js';

const router = Router();

// 메모리 상 로봇 상태(임시)
let robotState = {
  joints: [0, 0, 0, 0, 0, 0],
  eePose: { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 }
};

router.get('/status', (_req, res) => {
  res.json({ ok: true, state: robotState });
});

router.post('/move', (req, res) => {
  const { joints, eePose } = req.body || {};
  if (Array.isArray(joints)) robotState.joints = joints;
  if (eePose && typeof eePose === 'object') robotState.eePose = eePose;

  logger.info('[robot] move', { joints, eePose });
  res.json({ ok: true, state: robotState });
});

export default router;
