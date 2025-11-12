// 비전 추론 요청 (Python 호출)

import { Router } from 'express';
import { inferVision } from '../services/visionService.js';

const router = Router();

/**
 * 프론트/백엔드 → 비전 서버에 이미지(or 캔버스 캡처) 전달
 * body 예시: { imageBase64: "data:image/png;base64,....", meta: {...} }
 */
router.post('/infer', async (req, res) => {
  try {
    const result = await inferVision(req.body);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
