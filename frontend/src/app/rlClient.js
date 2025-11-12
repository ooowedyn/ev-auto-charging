// 강화학습 서버 통신 (sendRlStep)

export async function sendRlStep(state) {
  try {
    const res = await fetch('http://localhost:3000/api/rl/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    const data = await res.json();
    console.log('[RL] action:', data.action);
    return data.action;
  } catch (err) {
    console.error('[RL] error', err);
  }
}