// Camera intrinsics helper
// Compute fx, fy, cx, cy from Three.js PerspectiveCamera + target resolution.
export function getIntrinsicsFromCamera(camera, width, height) {
  const fovRad = (camera.fov * Math.PI) / 180;
  const fy = (0.5 * height) / Math.tan(fovRad / 2);
  const fx = fy;
  const cx = width / 2;
  const cy = height / 2;
  return { fx, fy, cx, cy };
}
