from env_armreach import ArmReachEnv
import numpy as np

env = ArmReachEnv()

for ep in range(3):
    state = env.reset()
    print(f"\n=== EPISODE {ep} ===")
    for t in range(10):
        # 랜덤 액션 (그냥 테스트용)
        action = np.random.uniform(low=-0.01, high=0.01, size=(6,))
        state, reward, done, info = env.step(action)

        print(
            f"t={t:02d}, "
            f"rew={reward:.3f}, "
            f"d_axial={info['d_axial']:.3f}, "
            f"e_radial={info['e_radial']:.3f}, "
            f"ori_err={info['ori_err']:.3f}, "
            f"success={info['success']}"
        )

        if done:
            print("  -> done, success:", info["success"])
            break