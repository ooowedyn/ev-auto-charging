#!/usr/bin/env bash
set -e

# ev-auto-charging 루트에서 실행한다고 가정
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONDA_SH="${CONDA_SH:-$HOME/miniconda3/etc/profile.d/conda.sh}"
CONDA_ENV="${CONDA_ENV:-RL}"
# 데이터 저장 기본 경로 (vision/dataset/raw/images)
DATASET_ROOT="${DATASET_ROOT:-$ROOT_DIR/vision/dataset/raw/images}"
RUN_ID="${RUN_ID:-run_$(date +%Y%m%d%H%M%S)}"

PIDS=()

start_rl() {
  (
    cd "$ROOT_DIR/control"   # RL 디렉토리 이름이 control인 것을 가정
    # conda 환경 활성화 (설치 경로/환경명은 CONDA_SH, CONDA_ENV로 오버라이드 가능)
    if [ -f "$CONDA_SH" ]; then
      # shellcheck source=/dev/null
      source "$CONDA_SH"
    else
      echo "conda.sh를 찾을 수 없습니다: $CONDA_SH"
      exit 1
    fi

    conda activate "$CONDA_ENV"
    python -m uvicorn main:app --reload --port 8000
  ) &
  PIDS+=($!)
}

start_backend() {
  (
    cd "$ROOT_DIR/backend"
    DATASET_ROOT="$DATASET_ROOT" RUN_ID="$RUN_ID" npm run dev
  ) &
  PIDS+=($!)
}

start_frontend() {
  (
    cd "$ROOT_DIR/frontend"
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

echo "▶ Frontend (Vite:5173) 시작"
start_frontend

echo "------------------------------"
echo "모든 dev 서버가 올라갔어 🚀"
echo "브라우저에서 http://localhost:5173 접속하면 됨"
echo "중단하려면 Ctrl+C 한 번 누르면 세 개 다 종료돼."
echo "------------------------------"

wait
