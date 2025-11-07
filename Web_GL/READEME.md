src/
main.js
core/robotArm.js
control/inputController.js
sensors/stereoRig.js
ui/hud.js
viz/createScene.js
viz/renderStereo.js
viz/renderTriple.js
config/jointMeta.js
utils/coords.js
utils/net.js
public/
untitled.glb

## 디렉터리/파일 역할

### src/main.js

    •	앱 부트스트랩(엔트리).
    •	씬/카메라/라이트/렌더러 생성 호출, GLTF 로드, RobotArm 조인트 연결.
    •	EE 팁에 StereoRig 장착, 뷰 모드 전환(single | stereo | triple) 및 메인 렌더 루프.
    •	IK(점 추종)와 조그 입력을 통합해 실행.

### src/core/robotArm.js

    •	로봇 팔 핵심 로직 (FK/IK/상태).
    •	GLTF에서 조인트 노드 찾기(별칭 매핑 지원), 기본 자세 캐시, 조인트 회전 적용(FK).
    •	CCD 기반 IK(목표 점 추종), 엔드이펙터 노드 조회.
    •	GLTF 원래 계층을 유지(강제 리패런팅 금지).

### src/control/inputController.js

    •	키보드 입력 처리.
    •	조그(1~6, Z/Shift), IK 토글(Space), IK 타깃 이동(WASDQE), 테스트 스윕/스핀(M/N/B/V/C/X).
    •	뷰 모드 토글(F/G). 지속 입력용 held map 관리.

### src/sensors/stereoRig.js

    •	스테레오 카메라 리그.
    •	좌/우 PerspectiveCamera 생성, baseline(두 카메라 간 거리) 설정.
    •	EE 팁 오프셋 노드(tipMount)에 쉽게 부착(attachTo) 할 수 있는 API 제공.
    •	내부파라미터(K) 계산 유틸, 카메라 헬퍼(프러스텀) 디버그 옵션.

### src/ui/hud.js

    •	HUD 오버레이 UI.
    •	현재 뷰 모드/프레임레이트/FK 각도 등 텍스트 출력.
    •	setExtra(text)로 디버그 정보(오차/신뢰도 등) 임시 표기 가능.

### src/viz/createScene.js

    •	시각화 초기화.
    •	씬/카메라/렌더러/컨트롤/바닥·그리드/라이트 구성.
    •	리사이즈 핸들러 포함(종횡비 갱신, 렌더러 크기 조정).

### src/viz/renderStereo.js

    •	2분할(좌/우) 스테레오 렌더러.
    •	autoClear=false + scissor + clearDepth()로 뷰포트 간 깊이 간섭 방지.
    •	좌·우 카메라를 한 프레임에 나란히 표시.

### src/viz/renderTriple.js

    •	3분할 렌더러(전역 + 좌/우).
    •	좌측 60% 전역 카메라, 우측 상/하에 L/R 카메라 배치.
    •	상황 파악용 콘솔 뷰 + 스테레오 뷰 동시 확인.

### src/config/jointMeta.js

    •	조인트 정의/설정.
    •	JOINT_ORDER: 조인트 순서(베이스→툴).
    •	JOINT_META: 각 조인트 로컬 회전축 벡터/리밋(필요 시 부호·축 수정).
    •	NAME_MAP: GLTF 실제 노드명 별칭 목록(모델명과 매칭할 때 사용).

### src/utils/coords.js

    •	좌표계/내부파라미터 유틸.
    •	three.js(−Z forward, Y up) ↔ CV(+Z forward, Y down) 변환 행렬 예시.
    •	카메라 K(fx, fy, cx, cy) 추출 헬퍼.

### src/utils/net.js

    •	통신 훅(백엔드 연동용).
    •	postJSON(url, payload) 등 간단한 HTTP 유틸.
    •	추후 YOLO/포즈 추정 서버와 연동 시 재사용.

### public/untitled.glb

    •	UR10(또는 로봇) GLTF 모델 파일.
    •	런타임에 GLTFLoader로 로드됨. (충전구/차량 모델은 동일 폴더에 추가 가능)
