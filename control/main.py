from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class StepRequest(BaseModel):
    state: list[float]  # [dx, dy, dz, droll, dpitch, dyaw]

class StepResponse(BaseModel):
    action: list[float]  # ex) 6개의 조인트 각도 변화량

@app.post("/step", response_model=StepResponse)
def step(req: StepRequest):
    state = req.state
    # TODO: 여기서 RL 정책/에이전트 호출해서 action 계산
    # 지금은 일단 모든 조인트 delta를 0으로 반환 (정지 정책)
    num_joints = 6
    action = [0.0] * num_joints
    return StepResponse(action=action)