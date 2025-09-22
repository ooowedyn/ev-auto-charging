# EVCI Dataset Preparation Guide

This project uses the `tools/EVCI_converter.py` script to convert COCO-style annotations into YOLO format.  
Follow the steps below to prepare the dataset.

---

## 1. Download the dataset
Save the following zip files into the `datasets/EVCI/` directory:

- `EVCI_A_set_Test.zip`
- `EVCI_A_set_Validation.zip`

Final structure example:
```
datasets/
└── EVCI/
    ├── EVCI_A_set_Test.zip
    └── EVCI_A_set_Validation.zip
```

---

## 2. Extract the zip files
Unzip the files into the `datasets/EVCI/` directory:

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

## 3. Convert annotations
Run the conversion script from the project root:

```bash
cd EVCI
python tools/EVCI_converter.py
```

After execution, the following folders will be generated:
```
datasets/
└── EVCI/
    └── labels/
        ├── train/
        └── val/
```

---

## 4. Prepare image files
The `images/train` and `images/val` folders are **not automatically created** by the converter.  
You must manually copy/move the corresponding images:

```
datasets/
└── EVCI/
    ├── images/
    │    ├── train/   <-- images from EVCI_A_set_Test
    │    └── val/     <-- images from EVCI_A_set_Validation
```

---

## Final folder structure
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
