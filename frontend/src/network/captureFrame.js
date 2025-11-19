export async function captureFrame(renderer) {
  const canvas = renderer.domElement;
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    }, 'image/jpeg', 0.8);
  });
}