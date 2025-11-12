from fastapi import FastAPI
from pydantic import BaseModel
from stable_baselines3 import PPO
import numpy as np

app = FastAPI()

# 학습된 PPO 모델 로드 (경로는 control 디렉토리 기준)
MODEL_PATH = "RL/ppo_local_insertion"
model = PPO.load(MODEL_PATH)


class StepRequest(BaseModel):
    state: list[float]  # [dx, dy, dz, droll, dpitch, dyaw]

class StepResponse(BaseModel):
    action: list[float]  # ex) 6개의 조인트 각도 변화량

@app.post("/step", response_model=StepResponse)
def step(req: StepRequest):
    # WebGL/Node에서 넘어온 state: [dx, dy, dz, droll, dpitch, dyaw]
    state = np.array(req.state, dtype=np.float32).reshape(1, -1)

    # PPO 정책에서 액션 예측 (deterministic=True로 고정된 정책 사용)
    action, _ = model.predict(state, deterministic=True)

    # SB3는 (batch, dim) 형태를 반환하므로 첫 번째 요소만 사용
    action_list = action[0].tolist()
    return StepResponse(action=action_list)