import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 3000;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/rl/step', async (req, res) => {
  try {
    const pyRes = await fetch('http://localhost:8000/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body), // { state: [...] }
    });

    const data = await pyRes.json();
    res.json(data);
  } catch (err) {
    console.error('[RL proxy error]', err);
    res.status(500).json({ error: 'RL proxy error' });
  }
});

app.listen(PORT, () => {
  console.log(`Node backend listening on http://localhost:${PORT}`);
});