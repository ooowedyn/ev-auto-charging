import numpy as np

class ArmReachEnv:
    def __init__(self):
        # 1) 기본설정
        self.max_steps = 100    # 타임아웃(step 수 제한)
        # 2) 포트 기준 좌표계 정의
        # 포트 입구 중심위치(로컬 시뮬 좌표계에서 원점에 있다고 가정)
        self.port_pos = np.array([0.0, 0.0, 0.0], dtype=np.float32) # 목표위치
        # - 포트 축 방향(예: +Z 방향으로 포트가 뻗어 나간다고 가정)
        # Three.js상에서 포트가 실제로 어느 축을 향하는지 보고 수정가능
        self.port_axis = np.array([0.0, 0.0, 1.0], dtype=np.float32)

        # 3) 삽입 타겟 깊이 및 허용 범위
        #    - d_target: 포트 입구에서 축 방향으로 얼마나 들어간 상태가 "완전 삽입"인가 (m 단위)
        self.d_target = 0.03    # 3 cm 안쪽이 완전 삽입 상태라고 가정
        self.d_max = 0.08       # 8 cm 이상 벗어나면 에피소드 실패로 처리

        # 허용 오차
        self.tol_axial = 0.005        # 축 방향 깊이 오차 허용 5 mm
        self.tol_radial = 0.005     # 옆으로 벗어나는 오차 허용 5 mm
        self.tol_ori = 0.05         # 자세 오차 허용 (라디안, 약 3도 정도)

        # 4) 보상 가중치
        self.w_axial = 1.0     # 축 방향 깊이 오차 가중치
        self.w_radial = 3.0    # 옆으로 벗어나는 오차는 더 강하게 패널티
        self.w_ori = 0.5       # 자세 오차 가중치

        # 5) "이상적인 완전 삽입 상태"의 EE 위치/자세 정의
        #    - target 위치는 포트 축을 따라 d_target만큼 들어간 지점
        self.target = (self.port_pos + self.d_target * self.port_axis).astype(np.float32)
        #    - target_ori는 포트 축과 정렬된 EE의 roll/pitch/yaw (간단히 0으로 가정)
        #      나중에 실제 포트 축 방향에 맞춰서 roll/pitch/yaw를 세밀하게 지정해도 됨.
        self.target_ori = np.zeros(3, dtype=np.float32)

        # EE 초기 자세 (reset에서 다시 랜덤으로 설정될 예정)
        self.ee_ori = np.random.uniform(low=-0.26, high=0.26, size=(3,)).astype(np.float32)

    def reset(self):
        """
        에피소드를 새로 시작
        로봇 EE를 랜덤한 시작위치에 놓고
        현재 state를 return
        """
        # EE 시작 위치를 "포트 근처"로 제한해서 로컬 정책을 학습
        # 예: 포트 기준 ±5 cm 범위 안에서 랜덤 시작
        pos_low = self.port_pos - np.array([0.05, 0.05, 0.02], dtype=np.float32)
        pos_high = self.port_pos + np.array([0.05, 0.05, 0.06], dtype=np.float32)
        self.ee_pos = np.random.uniform(low=pos_low, high=pos_high).astype(np.float32)

        # EE 시작 자세 (롤/피치/요 약 ±15도 범위 랜덤)
        self.ee_ori = np.random.uniform(low=-0.26, high=0.26, size=(3,)).astype(np.float32)

        self.step_count = 0
        return self._get_state()
    
    def _get_state(self):
        """
        상태 벡터:
        - 위치: 포트 중심 - EE 현재 위치  (Three.js에서의 portPos - plugPos에 대응)
        - 자세: 타겟(포트 기준) 자세 - EE 현재 자세
        즉, [dx, dy, dz, droll, dpitch, dyaw] 형태 (shape: (6,))
        """
        diff_pos = self.port_pos - self.ee_pos
        diff_ori = self.target_ori - self.ee_ori
        state = np.concatenate([diff_pos, diff_ori]).astype(np.float32)
        return state
        
    def _distance_to_target(self):
        diff = self.target - self.ee_pos
        return float(np.linalg.norm(diff))
    
    def _compute_errors(self, ee_pos: np.ndarray, ee_ori: np.ndarray):
        """
        포트 기준으로 EE의 상대 위치/자세 에러를 계산.
        - 축 방향 깊이 오차 (axial)
        - 축에 수직인 측면 오차 (radial)
        - 자세 오차 (orientation)
        """
        # 상대 위치 (포트 기준)
        dp = ee_pos - self.port_pos  # (3,)

        # 포트 축 단위 벡터
        n = self.port_axis / (np.linalg.norm(self.port_axis) + 1e-8)

        # 축 방향 성분 (삽입 깊이: 포트 입구 평면으로부터 얼마나 들어왔나)
        d_axial = float(np.dot(dp, n))

        # 축에 수직인 성분 (옆으로 얼마나 벗어났나)
        dp_radial = dp - d_axial * n
        e_radial = float(np.linalg.norm(dp_radial))

        # 자세 오차 (간단히 Euler 차이의 L2 norm 사용)
        ori_err = float(np.linalg.norm(self.target_ori - ee_ori))

        # 축 방향 깊이 오차 (목표 깊이 d_target과의 차이)
        axial_err = abs(d_axial - self.d_target)

        return d_axial, e_radial, ori_err, axial_err
    
    def step(self, action):
        """
        action: shape(6,)이라 가정
        - 앞 3개: x, y, z 방향 EE 위치 변화
        - 뒤 3개: roll, pitch, yaw 변화
        실제 로봇에서는 이 자리에 조인트 갱신 로직(FK) 등이 들어갈 수 있음.
        """

        self.step_count += 1

        # 액션 클리핑(한 번에 너무 크게 안 움직이게)
        action = np.clip(np.array(action, dtype=np.float32), -0.05, 0.05)

        # EE pose update
        self.ee_pos += action[:3]
        self.ee_ori += action[3:]

        # 새로운 상태 (타겟-현재)
        state = self._get_state()

        # --- 에러 계산 (축 방향/측면/자세) ---
        d_axial, e_radial, ori_err, axial_err = self._compute_errors(
            self.ee_pos, self.ee_ori
        )

        # --- 보상 계산 ---
        # 축 방향 깊이 오차, 측면 오차, 자세 오차를 모두 패널티로 사용
        reward = -(
            self.w_axial * axial_err +
            self.w_radial * e_radial +
            self.w_ori * ori_err
        )

        done = False
        success = False

        # 포트 앞/뒤 범위를 크게 벗어난 경우는 실패로 간주 (말이 안 되는 삽입 상태)
        if d_axial < 0.0 or d_axial > self.d_max:
            reward -= 10.0
            done = True

        # --- 성공 판정 (결합 상태) ---
        # 1) 축 방향 깊이: 목표 깊이 d_target 근처
        # 2) 측면 오차: 거의 0 (포트 축에서 많이 안 벗어남)
        # 3) 자세 오차: 포트 축과 잘 정렬된 상태
        if (axial_err < self.tol_axial and
            e_radial < self.tol_radial and
            ori_err < self.tol_ori):
            reward += 100.0
            success = True
            done = True

        # 타임아웃
        timeout = self.step_count >= self.max_steps
        if timeout and not done:
            done = True

        info = {
            "d_axial": d_axial,       # 포트 축 방향 깊이
            "e_radial": e_radial,     # 옆으로 벗어난 정도
            "ori_err": ori_err,       # 자세 오차
            "axial_err": axial_err,   # 목표 깊이와의 차이
            "success": success,
            "timeout": timeout,
        }

        return state, reward, done, info