# RL for EV Charger Alignment (ArmReach Task)

## Task

엔드 이펙터(EE)를 타겟(충전구 위치/각도)에 정렬시키는 제어를 학습.

## State (관측)

s = [dx, dy, dz]
= 목표 위치 - 현재 EE 위치

(추후 yaw/pitch/roll 오차까지 확장 예정)

## Action (행동)

a = [Δx, Δy, Δz] (현재는 단순화)
-> 실제 시스템에서는 조인트별 Δθ로 대체 예정.

## Reward

r = - ||EE - target||

- (성공 시) +100 보너스

## Episode 종료

- EE와 target의 거리가 2cm 이하이면 성공 종료
- max_steps=100 이 지나면 타임아웃 종료
