"""
Dataset filename helpers for GT-embedded naming.

Filename format (per spec):
    {id}_{timestamp}_{x}_{y}_{z}_{qx}_{qy}_{qz}_{qw}.png

- Decimal points are replaced with 'd'
- Minus sign is replaced with 'm'
"""

from __future__ import annotations


def encode_number(x: float, digits: int = 3) -> str:
    s = f"{float(x):.{digits}f}"
    return s.replace("-", "m").replace(".", "d")


def build_filename(idx: int, timestamp: int, pos, quat, digits: int = 6) -> str:
    """
    Args:
        idx: sequential id (int)
        timestamp: epoch ms or YYMMDDhhmmss style int
        pos: iterable (x,y,z)
        quat: iterable (qx,qy,qz,qw)
    """
    p = [encode_number(v, digits) for v in pos]
    q = [encode_number(v, digits) for v in quat]
    return f"{idx:06d}_{timestamp}_{'_'.join(p)}_{'_'.join(q)}.png"


def parse_filename(name: str):
    """
    Reverse of build_filename. Returns (id:int, timestamp:str, pos, quat)
    Assumes the naming convention exactly.
    """
    stem = name.split(".")[0]
    parts = stem.split("_")
    if len(parts) != 9:
        raise ValueError(f"invalid filename pattern: {name}")
    idx = int(parts[0])
    timestamp = parts[1]

    def decode(token: str) -> float:
        return float(token.replace("m", "-").replace("d", "."))

    pos = tuple(decode(t) for t in parts[2:5])
    quat = tuple(decode(t) for t in parts[5:9])
    return idx, timestamp, pos, quat
