#!/usr/bin/env bash
set -e

# ev-auto-charging 루트에서 실행한다고 가정
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PIDS=()

start_rl() {
  (
    cd "$ROOT_DIR/control"   # RL 디렉토리 이름이 control인 것을 가정
    # conda 환경 활성화 (설치 경로는 본인 환경에 맞게 수정 가능)
    source "/Users/yeonseongsmac/miniconda3/etc/profile.d/conda.sh"

    conda activate RL
    python -m uvicorn main:app --reload --port 8000
  ) &
  PIDS+=($!)
}

start_backend() {
  (
    cd "$ROOT_DIR/backend"
    npm run dev
  ) &
  PIDS+=($!)
}

start_web() {
  (
    cd "$ROOT_DIR/Web_GL"       # 폴더 이름이 webgl-sim이면 여기 수정
    npm run dev
  ) &
  PIDS+=($!)
}

cleanup() {
  echo
  echo "▶ 모든 프로세스 종료 중..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  exit 0
}

trap cleanup INT

echo "▶ RL 서버 시작 (FastAPI:8000)"
start_rl
sleep 1

echo "▶ Node 백엔드 시작 (3000)"
start_backend
sleep 1

echo "▶ WebGL 프론트엔드 시작 (Vite:5173)"
start_web

echo "------------------------------"
echo "모든 dev 서버가 올라갔어 🚀"
echo "브라우저에서 http://localhost:5173 접속하면 됨"
echo "중단하려면 Ctrl+C 한 번 누르면 세 개 다 종료돼."
echo "------------------------------"

wait