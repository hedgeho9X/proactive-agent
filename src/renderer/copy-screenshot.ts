export interface ImageLayer {
  color: string;
  opacity: number;
  box: { left: number; top: number; width: number; height: number };
}
// 在原图分辨率合成当前标注，复制结果不依赖预览缩放比例。
export async function screenshotPNG(data: string, layers: ImageLayer[]) {
  const image = new Image();
  image.src = "data:image/png;base64," + data;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_unavailable");
  context.drawImage(image, 0, 0);
  for (const layer of layers) {
    const x = (layer.box.left * canvas.width) / 100,
      y = (layer.box.top * canvas.height) / 100,
      w = (layer.box.width * canvas.width) / 100,
      h = (layer.box.height * canvas.height) / 100;
    context.globalAlpha = layer.opacity;
    context.fillStyle = layer.color;
    context.fillRect(x, y, w, h);
    context.globalAlpha = 1;
    context.strokeStyle = layer.color;
    context.lineWidth = 2;
    context.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
  }
  return canvas.toDataURL("image/png");
}
