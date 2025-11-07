/*
Networking Helpers(Backend I/O)
---------------------------------------
역할:
  - 간단한 HTTP POST JSON 유틸 (fetch 래퍼)
  - 추후 YOLO/포즈 추정 서버와 연동 시 재사용

주요 Export:
  - async function postJSON(url, payload)

자주 수정하는 지점:
  - 인증/에러 처리/타임아웃/재시도 정책
*/

export async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
