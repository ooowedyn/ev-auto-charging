import torch
import torch.nn as nn
from torchvision import models

try:
    from model.mobilenetv3 import mobilenetv3_large
except ModuleNotFoundError:
    # Fallback when imported from project root (vision/src)
    from .mobilenetv3 import mobilenetv3_large


def build_backbone(name: str, pretrained_path: str = None):
    name = name.lower()
    if name == "mobilenet_v2":
        m = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V2)
        feat_dim = m.classifier[1].in_features
        m.classifier = nn.Identity()
        return m, feat_dim

    elif name == "mobilenet_v3":
        m = mobilenetv3_large()
        if pretrained_path:
            state = torch.load(pretrained_path, map_location="cpu")
            if "state_dict" in state:
                state = state["state_dict"]
            if isinstance(state, dict):
                missing, unexpected = m.load_state_dict(state, strict=False)
                print(f"[mobilenet_v3] loaded pretrained (missing={len(missing)}, unexpected={len(unexpected)})")
        # classifier[0] is Linear(exp_size -> output_channel), exp_size is the flatten dim
        feat_dim = m.classifier[0].in_features  # typically 960 for mobilenetv3-large
        m.classifier = nn.Identity()
        return m, feat_dim

    else:
        raise ValueError(f"Unknown backbone: {name} (supported: mobilenet_v2, mobilenet_v3)")


class PoseRegressor(nn.Module):
    """
    이미지 → 7D pose [x, y, z, qx, qy, qz, qw] 회귀 모델.
    - x, y, z: 학습 시에는 train.py에서 pos_scale 배로 스케일된 값 사용
    - q*: 항상 단위 쿼터니언으로 정규화해서 출력
    """
    def __init__(self, backbone: str = "mobilenet_v3", pretrained_path: str = None):
        super().__init__()
        self.backbone, feat_dim = build_backbone(backbone, pretrained_path)
        self.fc = nn.Sequential(
            nn.Linear(feat_dim, 512),
            nn.ReLU(inplace=True),
            nn.Linear(512, 256),
            nn.ReLU(inplace=True),
            nn.Linear(256, 7),
        )

    def forward(self, x):
        feats = self.backbone(x)
        if isinstance(feats, (tuple, list)):
            feats = feats[-1]
        feats = torch.flatten(feats, 1)

        out = self.fc(feats)      # (B, 7)
        pos = out[:, :3]          # 스케일된 좌표 (train.py에서 pos_scale 적용)
        quat_raw = out[:, 3:]     # 정규화 전 쿼터니언
        quat = quat_raw / (quat_raw.norm(dim=1, keepdim=True) + 1e-8)
        return torch.cat([pos, quat], dim=1)
