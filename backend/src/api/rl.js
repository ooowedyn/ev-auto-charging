// 강화학습 추론 요청 (Python 호출)

import { Router } from 'express';
import { inferRL } from '../services/rlService.js';

const router = Router();

/**
 * 비전 결과 + 로봇 상태 → RL 정책 추론 (action 반환)
 * body 예시: { state: {...}, vision: {...} }
 */
router.post('/infer', async (req, res) => {
  try {
    const action = await inferRL(req.body);
    res.json({ ok: true, action });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
