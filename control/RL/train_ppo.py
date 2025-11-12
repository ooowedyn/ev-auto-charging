from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
from env_wrapper import ArmReachGymEnv

if __name__ == "__main__":
    def make_env():
        return ArmReachGymEnv()

    vec_env = DummyVecEnv([make_env])

    model = PPO(
        policy="MlpPolicy",
        env=vec_env,
        verbose=1,
    )

    # 학습
    model.learn(total_timesteps=200_000)
    model.save("ppo_local_insertion")


    # 학습 끝난 정책을 한 번 rollout 해보는 것도 가능
    # 주의: Stable-Baselines3의 VecEnv API는 Gymnasium API와 조금 다르다.
    # vec_env.reset() -> obs 만 반환 (obs shape: (num_env, obs_dim))
    # vec_env.step(action_batch) -> obs, rewards, dones, infos

    # 학습된 정책으로 rollout
    obs = vec_env.reset()
    for _ in range(50):
        action, _ = model.predict(obs, deterministic=True)
        obs, rewards, dones, infos = vec_env.step(action)

        print("rewards:", rewards, "infos:", infos)

        if dones[0]:
            obs = vec_env.reset()