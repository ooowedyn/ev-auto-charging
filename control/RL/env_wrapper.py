import gymnasium as gym
from gymnasium import spaces
import numpy as np

# 실행 방식에 따라 둘 중 하나로 선택
# 1) 모듈 실행: python -m src.RL.train_ppo  를 쓸 거면
from env_armreach import ArmReachEnv
# 2) 그냥 python src/RL/train_ppo.py 로 실행할 거면
# from env_armreach import ArmReachEnv


class ArmReachGymEnv(gym.Env):
    """
    Stable-Baselines3에서 쓸 수 있도록 ArmReachEnv를 감싸는 래퍼.
    """

    def __init__(self):
        super().__init__()

        # 실제 로직 담당 env
        self.env = ArmReachEnv()

        # ----- 관측/행동 space 정의 -----

        # state = [dx, dy, dz, droll, dpitch, dyaw]  → shape (6,)
        self.observation_space = spaces.Box(
            low=-np.inf,
            high=np.inf,
            shape=(6,),
            dtype=np.float32,
        )

        # action = [Δx, Δy, Δz, Δroll, Δpitch, Δyaw]  → shape (6,)
        # env.step() 안에서도 [-0.05, 0.05] 로 클리핑하고 있으니 동일 범위로 맞춤
        self.action_space = spaces.Box(
            low=-0.05,
            high=0.05,
            shape=(6,),
            dtype=np.float32,
        )

    def reset(self, *, seed=None, options=None):
        # gymnasium 스타일: seed를 받으면 부모 reset에 넘겨주는 관례
        super().reset(seed=seed)

        # 실제 내부 env는 seed를 안 쓰고 있어서, 그냥 무시하고 reset 호출
        obs = self.env.reset()

        info = {}  # 추가 정보 없으니까 일단 빈 dict
        return obs, info

    def step(self, action):
        obs, reward, done, info = self.env.step(action)

        # gymnasium 스타일로 변환:
        terminated = done      # 우리가 정의한 done을 terminated로 사용
        truncated = False      # 타임리밋/강제 중단 구분하고 싶으면 info로 빼도 됨

        return obs, reward, terminated, truncated, info

    def render(self, mode="human"):
        # 시각화는 Three.js 쪽에서 하니까 여기서는 안 해도 됨
        pass

    def close(self):
        pass