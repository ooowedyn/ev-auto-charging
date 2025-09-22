# EVCI Dataset 준비 가이드

본 프로젝트에서는 COCO 형식의 어노테이션을 YOLO 형식으로 변환하기 위해 `tools/EVCI_converter.py` 스크립트를 사용합니다.  
아래 절차를 따라 데이터셋을 준비하세요.

---

## 1. 데이터셋 다운로드
[EVCI dataset](https://github.com/machinevision-seoultech/evci?tab=readme-ov-file)
아래 zip 파일들을 `datasets/EVCI/` 경로에 저장합니다.

- `EVCI_A_set_Test.zip`
- `EVCI_A_set_Validation.zip`

최종 구조 예시:
```
datasets/
└── EVCI/
    ├── EVCI_A_set_Test.zip
    └── EVCI_A_set_Validation.zip
```

---

## 2. 압축 해제
각 zip 파일을 `datasets/EVCI/` 경로에 풀어주세요.

```
datasets/
└── EVCI/
    ├── EVCI_A_set_Test/
    │    ├── images/...
    │    └── instances_Test.json
    ├── EVCI_A_set_Validation/
    │    ├── images/...
    │    └── instances_Validate.json
```

---

## 3. 어노테이션 변환
프로젝트 루트에서 변환 스크립트를 실행합니다:

```bash
cd EVCI
python tools/EVCI_converter.py
```

실행 후 생성되는 폴더:
```
datasets/
└── EVCI/
    └── labels/
        ├── train/
        └── val/
```

---

## 4. 이미지 파일 준비
`images/train`, `images/val` 폴더는 변환기로 자동 생성되지 않습니다.  
따라서 **사용자가 직접 복사/이동**해야 합니다:

```
datasets/
└── EVCI/
    ├── images/
    │    ├── train/   <-- EVCI_A_set_Test 이미지들
    │    └── val/     <-- EVCI_A_set_Validation 이미지들
```

---

## 최종 폴더 구조
```
datasets/
└── EVCI/
    ├── images/
    │    ├── train/
    │    └── val/
    ├── labels/
    │    ├── train/
    │    └── val/
    ├── EVCI_A_set_Test/
    ├── EVCI_A_set_Validation/
    └── ...
```

