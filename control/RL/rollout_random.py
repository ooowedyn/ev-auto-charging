import numpy as np
from env_armreach import ArmReachEnv

if __name__ == "__main__":
    env = ArmReachEnv()

    for episode in range(3):
        state = env.reset()
        total_reward = 0.0

        for t in range(200):
            action = np.random.uniform(low=-0.05, high=0.05, size=(3,))
            next_state, reward, done, info = env.step(action)

            total_reward += reward
            print(f"[ep {episode} | step {t}] state={state}, action={action}, "
                  f"reward={reward:.3f}, dist={info['dist']:.3f}")

            state = next_state
            if done:
                print(f"Episode {episode} finished at step {t} "
                      f"success={info['success']} total_reward={total_reward:.3f}")
                break