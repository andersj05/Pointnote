import { PRIVATE_SELECTOR, bounds } from './context';
import { rpc } from './rpc';
import type { Screenshot, Bounds } from './types';
function privateRegions(host: HTMLElement) {
  const sensitive = [...document.querySelectorAll(PRIVATE_SELECTOR)];
  for (const el of document.querySelectorAll('*'))
    if ((el.shadowRoot || el.localName.includes('-')) && el !== host)
      sensitive.push(el);
  return [...new Set(sensitive)]
    .filter((el) => !host.contains(el))
    .flatMap((el) => [...el.getClientRects()])
    .filter(
      (r) =>
        r.width > 0 &&
        r.height > 0 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.top < innerHeight &&
        r.left < innerWidth,
    );
}
export async function captureScreenshot(
  elements: Element[],
  host: HTMLElement,
  root: ShadowRoot,
  path: string,
  outlines?: Bounds[],
): Promise<Screenshot> {
  const masks = document.createElement('div');
  masks.className = 'capture-masks';
  const regions = privateRegions(host);
  for (const r of regions) {
    const mask = document.createElement('div');
    mask.className = 'privacy-mask';
    Object.assign(mask.style, {
      left: r.left - 3 + 'px',
      top: r.top - 3 + 'px',
      width: r.width + 6 + 'px',
      height: r.height + 6 + 'px',
    });
    masks.append(mask);
  }
  const viewport = {
    width: innerWidth,
    height: innerHeight,
    x: scrollX,
    y: scrollY,
  };
  const targetRects = elements.map(bounds);
  if (
    !(outlines?.length === 0 && !elements.length) &&
    !(outlines || targetRects).some(
      (r) =>
        r.x < innerWidth &&
        r.y < innerHeight &&
        r.x + r.width > 0 &&
        r.y + r.height > 0,
    )
  )
    return {
      status: 'unavailable',
      reason:
        'Target is outside the visible viewport. Revisit it and reattach to capture a new screenshot.',
    };
  root.append(masks);
  host.setAttribute('data-capturing', '');
  try {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const data = await rpc<string>({ type: 'CAPTURE' });
    const afterRegions = privateRegions(host);
    if (JSON.stringify(regions) !== JSON.stringify(afterRegions))
      throw new Error(
        'Private regions moved during capture. Capture was discarded; try again when the page is still.',
      );
    if (
      innerWidth !== viewport.width ||
      innerHeight !== viewport.height ||
      scrollX !== viewport.x ||
      scrollY !== viewport.y ||
      elements.some((el, i) => {
        const r = bounds(el),
          old = targetRects[i];
        return (
          !el.isConnected ||
          Math.abs(r.x - old.x) > 2 ||
          Math.abs(r.y - old.y) > 2 ||
          Math.abs(r.width - old.width) > 2 ||
          Math.abs(r.height - old.height) > 2
        );
      })
    )
      throw new Error(
        'Page layout changed during screenshot capture. Save again when the page is still.',
      );
    const img = new Image();
    img.src = data;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(img.width, 1600);
    canvas.height = Math.round((img.height * canvas.width) / img.width);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const scaleX = canvas.width / viewport.width,
      scaleY = canvas.height / viewport.height;
    // Burn in masks as well as displaying them during capture.
    ctx.fillStyle = '#dce1df';
    for (const r of regions)
      ctx.fillRect(
        (r.left - 3) * scaleX,
        (r.top - 3) * scaleY,
        (r.width + 6) * scaleX,
        (r.height + 6) * scaleY,
      );
    ctx.strokeStyle = '#d6512b';
    ctx.lineWidth = 3;
    ctx.font = 'bold 16px sans-serif';
    (outlines || targetRects).forEach((r, i) => {
      ctx.strokeRect(
        r.x * scaleX,
        r.y * scaleY,
        r.width * scaleX,
        r.height * scaleY,
      );
      const x = Math.max(1, Math.min(canvas.width - 30, r.x * scaleX)),
        y = Math.max(22, Math.min(canvas.height - 4, r.y * scaleY));
      ctx.fillStyle = '#d6512b';
      ctx.fillRect(x, y - 22, 26, 22);
      ctx.fillStyle = 'white';
      ctx.fillText(String(i + 1), x + 8, y - 5);
    });
    return {
      status: 'available',
      path,
      dataUrl: canvas.toDataURL('image/png'),
      capturedAt: new Date().toISOString(),
      width: canvas.width,
      height: canvas.height,
      redactedRegions: regions.length,
      note:
        (elements.length
          ? 'Visible viewport; orange outlines label targets in selection order.'
          : outlines?.length
            ? 'Visible viewport; orange outline marks the selected area at capture time. This is a visual reference, not a tracked element.'
            : 'Page-level feedback; this image shows the visible viewport at capture time.') +
        ' Form controls, editable/private regions, embedded frames, custom elements and open shadow hosts are masked. Offscreen portions are not captured.',
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    masks.remove();
    host.removeAttribute('data-capturing');
  }
}
