// 키 입력 관리 (포커스 토글/캡처/포즈 전송/카메라 이동 키 상태)
export function initKeyControls({
  socket,
  captureAndSendFrame,
  sendDetection,
  getFocus,
  setFocus,
  camMoveKeys,
  robot,
}) {
  const blockKeys = [
    'KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE',
    'Space','Digit1','Digit2','Digit3','Digit4','Digit5','Digit6',
    'KeyZ','KeyF','KeyG','KeyU','KeyI','KeyO','Digit8','Digit9','Digit0','KeyK'
  ];

  const onKeyDown = (e) => {
    if (blockKeys.includes(e.code) || e.code === 'Tab') e.preventDefault();

    if (e.code === 'KeyP') {
      const joints = Object.values(robot.angles);
      socket.send('pose-update', { joints });
      console.log('[WS] pose sent');
    }
    if (e.code === 'KeyL' && captureAndSendFrame) captureAndSendFrame();
    if (e.code === 'KeyK' && sendDetection) sendDetection();
    if (e.code === 'Tab') {
      const next = getFocus() === 'USER' ? 'ARM_CAM' : 'USER';
      setFocus(next);
      // Tab 기본 포커스 이동 방지 (canvas 포커스 유지)
      e.preventDefault();
    }
    if (getFocus() === 'USER') {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) camMoveKeys[e.code] = true;
    }
  };

  const onKeyUp = (e) => {
    if (getFocus() === 'USER') {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) camMoveKeys[e.code] = false;
    }
  };

  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}
