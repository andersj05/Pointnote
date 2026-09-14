import type { ImagePoint, ScreenshotImage, ScreenshotMark } from './types';

const SVG = 'http://www.w3.org/2000/svg';
const ink = '#db542c';
function geometry(width: number, height: number) {
  const unit = Math.max(14, Math.min(28, Math.min(width, height) * 0.025));
  return { unit, stroke: Math.max(2.5, unit / 5) };
}
function arrowPath(
  from: ImagePoint,
  to: ImagePoint,
  width: number,
  height: number,
  unit: number,
) {
  const x = to.x * width,
    y = to.y * height;
  const angle = Math.atan2(y - from.y * height, x - from.x * width);
  return `M${from.x * width} ${from.y * height}L${x} ${y}M${x - unit * Math.cos(angle - Math.PI / 6)} ${y - unit * Math.sin(angle - Math.PI / 6)}L${x} ${y}L${x - unit * Math.cos(angle + Math.PI / 6)} ${y - unit * Math.sin(angle + Math.PI / 6)}`;
}
export function markupSvg(
  width: number,
  height: number,
  marks: ScreenshotMark[],
): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');
  const { unit, stroke } = geometry(width, height);
  let number = 0;
  for (const mark of marks) {
    if (mark.kind === 'arrow') {
      for (const [color, size] of [
        ['white', stroke + 3],
        [ink, stroke],
      ] as const) {
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute(
          'd',
          arrowPath(mark.from, mark.to, width, height, unit),
        );
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', String(size));
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.append(path);
      }
    } else {
      const circle = document.createElementNS(SVG, 'circle');
      circle.setAttribute('cx', String(mark.at.x * width));
      circle.setAttribute('cy', String(mark.at.y * height));
      circle.setAttribute('r', String(unit));
      circle.setAttribute('fill', ink);
      circle.setAttribute('stroke', 'white');
      circle.setAttribute('stroke-width', '3');
      const label = document.createElementNS(SVG, 'text');
      label.setAttribute('x', String(mark.at.x * width));
      label.setAttribute('y', String(mark.at.y * height));
      label.setAttribute('fill', 'white');
      label.setAttribute('font-family', 'system-ui, sans-serif');
      label.setAttribute('font-size', String(unit * 1.1));
      label.setAttribute('font-weight', '700');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'central');
      label.textContent = String(++number);
      svg.append(circle, label);
    }
  }
  return svg;
}
export async function renderMarkedImage(
  image: ScreenshotImage,
  marks: ScreenshotMark[],
): Promise<string> {
  if (!image.dataUrl?.startsWith('data:image/png;base64,'))
    throw new Error('The original image is unavailable.');
  const original = new Image();
  original.src = image.dataUrl;
  await original.decode();
  const canvas = document.createElement('canvas');
  canvas.width = original.width;
  canvas.height = original.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  ctx.drawImage(original, 0, 0);
  const { unit, stroke } = geometry(canvas.width, canvas.height);
  let number = 0;
  for (const mark of marks) {
    if (mark.kind === 'arrow') {
      const path = new Path2D(
        arrowPath(mark.from, mark.to, canvas.width, canvas.height, unit),
      );
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'white';
      ctx.lineWidth = stroke + 3;
      ctx.stroke(path);
      ctx.strokeStyle = ink;
      ctx.lineWidth = stroke;
      ctx.stroke(path);
    } else {
      const x = mark.at.x * canvas.width,
        y = mark.at.y * canvas.height;
      ctx.beginPath();
      ctx.arc(x, y, unit, 0, Math.PI * 2);
      ctx.fillStyle = ink;
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.font = `700 ${unit * 1.1}px system-ui`;
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(++number), x, y);
    }
  }
  return canvas.toDataURL('image/png');
}
