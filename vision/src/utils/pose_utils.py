"""
Utility functions for pose math (homogeneous transforms) used in GT computation.

Key API:
    - to_matrix(position, quaternion) -> (4,4) numpy array
    - from_matrix(matrix) -> (position, quaternion)
    - relative_pose(t_world_tcp, t_world_socket) -> dict with position/orientation

All quaternions are in (x, y, z, w) order.
"""

import numpy as np


def _quat_to_matrix(q):
    """Convert quaternion (x, y, z, w) to 3x3 rotation matrix."""
    x, y, z, w = q
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z

    return np.array(
        [
            [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy)],
            [2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx)],
            [2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy)],
        ],
        dtype=float,
    )


def _matrix_to_quat(R):
    """Convert 3x3 rotation matrix to quaternion (x, y, z, w)."""
    m = np.asarray(R, dtype=float)
    t = np.trace(m)
    if t > 0:
        s = 0.5 / np.sqrt(t + 1.0)
        w = 0.25 / s
        x = (m[2, 1] - m[1, 2]) * s
        y = (m[0, 2] - m[2, 0]) * s
        z = (m[1, 0] - m[0, 1]) * s
    else:
        if m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
            s = 2.0 * np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2])
            w = (m[2, 1] - m[1, 2]) / s
            x = 0.25 * s
            y = (m[0, 1] + m[1, 0]) / s
            z = (m[0, 2] + m[2, 0]) / s
        elif m[1, 1] > m[2, 2]:
            s = 2.0 * np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2])
            w = (m[0, 2] - m[2, 0]) / s
            x = (m[0, 1] + m[1, 0]) / s
            y = 0.25 * s
            z = (m[1, 2] + m[2, 1]) / s
        else:
            s = 2.0 * np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1])
            w = (m[1, 0] - m[0, 1]) / s
            x = (m[0, 2] + m[2, 0]) / s
            y = (m[1, 2] + m[2, 1]) / s
            z = 0.25 * s
    return np.array([x, y, z, w], dtype=float)


def to_matrix(position, quaternion):
    """
    Build 4x4 homogeneous matrix from position/quaternion.

    Args:
        position: iterable of (x, y, z)
        quaternion: iterable of (qx, qy, qz, qw)
    """
    t = np.eye(4, dtype=float)
    t[:3, :3] = _quat_to_matrix(quaternion)
    t[:3, 3] = np.asarray(position, dtype=float)
    return t


def from_matrix(matrix):
    """
    Decompose 4x4 homogeneous matrix into (position, quaternion).

    Returns:
        position: np.ndarray shape (3,)
        quaternion: np.ndarray shape (4,) in (x, y, z, w)
    """
    m = np.asarray(matrix, dtype=float)
    pos = m[:3, 3].copy()
    quat = _matrix_to_quat(m[:3, :3])
    return pos, quat


def relative_pose(t_world_tcp, t_world_socket):
    """
    Compute T_tcp_socket = inverse(T_world_tcp) · T_world_socket
    and return position/quaternion for GT.

    Args:
        t_world_tcp: 4x4 homogeneous matrix (numpy)
        t_world_socket: 4x4 homogeneous matrix (numpy)
    Returns:
        dict: { "position": [x, y, z], "orientation": [qx, qy, qz, qw] }
    """
    t_tcp_world = np.linalg.inv(t_world_tcp)
    t_tcp_socket = t_tcp_world @ t_world_socket
    pos, quat = from_matrix(t_tcp_socket)
    return {"position": pos.tolist(), "orientation": quat.tolist()}


def relative_pose_from_components(tcp_pos, tcp_quat, socket_pos, socket_quat):
    """
    Convenience wrapper when you have position/quaternion pairs.
    """
    t_world_tcp = to_matrix(tcp_pos, tcp_quat)
    t_world_socket = to_matrix(socket_pos, socket_quat)
    return relative_pose(t_world_tcp, t_world_socket)
