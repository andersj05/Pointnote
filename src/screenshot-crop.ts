import type { Bounds, ScreenshotCrop } from './types';

// Crop only pixels from this captured viewport. Never imply offscreen evidence exists.
export function visibleCrop(
  rect: Bounds,
  width: number,
  height: number,
): { bounds: Bounds; clipped: boolean } | undefined {
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x >= width ||
    rect.y >= height ||
    rect.x + rect.width <= 0 ||
    rect.y + rect.height <= 0
  )
    return;
  const x = Math.max(0, rect.x - 24),
    y = Math.max(0, rect.y - 24);
  return {
    bounds: {
      x,
      y,
      width: Math.min(width, rect.x + rect.width + 24) - x,
      height: Math.min(height, rect.y + rect.height + 24) - y,
    },
    clipped:
      rect.x < 0 ||
      rect.y < 0 ||
      rect.x + rect.width > width ||
      rect.y + rect.height > height,
  };
}

export function captureCrops(
  masked: HTMLCanvasElement,
  rects: Bounds[],
  viewport: { width: number; height: number },
  path: string,
  elementTargets: boolean,
): ScreenshotCrop[] {
  let used = 0;
  return rects.map((rect, index) => {
    const identity = elementTargets ? { targetIndex: index } : {};
    const visible = visibleCrop(rect, viewport.width, viewport.height);
    if (!visible)
      return {
        ...identity,
        status: 'unavailable',
        reason: 'Target is outside this captured viewport.',
      };
    const scaleX = masked.width / viewport.width,
      scaleY = masked.height / viewport.height;
    const sx = Math.floor(visible.bounds.x * scaleX),
      sy = Math.floor(visible.bounds.y * scaleY);
    const sw = Math.min(
        masked.width - sx,
        Math.ceil(visible.bounds.width * scaleX),
      ),
      sh = Math.min(
        masked.height - sy,
        Math.ceil(visible.bounds.height * scaleY),
      );
    const scale = Math.min(1, 2400 / sw, 2400 / sh);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx)
      return {
        ...identity,
        status: 'unavailable',
        reason: 'Close-up canvas is unavailable.',
      };
    ctx.drawImage(masked, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#d6512b';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      (rect.x * scaleX - sx) * scale,
      (rect.y * scaleY - sy) * scale,
      rect.width * scaleX * scale,
      rect.height * scaleY * scale,
    );
    const dataUrl = canvas.toDataURL('image/png');
    if (used + dataUrl.length > 8000000)
      return {
        ...identity,
        status: 'unavailable',
        reason: 'Close-up omitted because this note reached its image limit.',
      };
    used += dataUrl.length;
    return {
      ...identity,
      ...visible,
      status: 'available',
      path: path.replace(/\.png$/, `-closeup-${index + 1}.png`),
      dataUrl,
      width: canvas.width,
      height: canvas.height,
    };
  });
}
