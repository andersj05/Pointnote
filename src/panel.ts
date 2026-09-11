import type { PanelBounds } from './preferences';

export function fitPanel(
  value: PanelBounds,
  viewport: { width: number; height: number },
): PanelBounds {
  const margin = 8;
  const width = Math.min(
    Math.max(320, value.width),
    Math.max(1, viewport.width - margin * 2),
  );
  const height = Math.min(
    Math.max(380, value.height),
    Math.max(1, viewport.height - margin * 2),
  );
  return {
    width,
    height,
    x: Math.max(margin, Math.min(value.x, viewport.width - width - margin)),
    y: Math.max(margin, Math.min(value.y, viewport.height - height - margin)),
  };
}

export function mountPanel(
  panel: HTMLElement,
  options: {
    initial?: PanelBounds;
    save: (bounds: PanelBounds) => void;
    canMove: () => boolean;
  },
) {
  const viewport = () => ({ width: innerWidth, height: innerHeight });
  const initial = () =>
    fitPanel(
      {
        x: innerWidth - 376,
        y: 16,
        width: 360,
        height: Math.min(520, innerHeight - 32),
      },
      viewport(),
    );
  let bounds = options.initial || initial();
  let minimized = false;
  let gesture:
    | {
        pointer: number;
        x: number;
        y: number;
        bounds: PanelBounds;
        resize: boolean;
        left: boolean;
      }
    | undefined;
  const paint = () => {
    const requestedY = bounds.y;
    bounds = fitPanel(bounds, viewport());
    if (minimized)
      bounds.y = Math.max(8, Math.min(requestedY, innerHeight - 54));
    Object.assign(panel.style, {
      left: bounds.x + 'px',
      top: bounds.y + 'px',
      width: bounds.width + 'px',
      height: (minimized ? 46 : bounds.height) + 'px',
    });
  };
  for (const handle of panel.querySelectorAll<HTMLElement>(
    '[data-panel-handle]',
  )) {
    const resize = handle.dataset.panelHandle !== 'move';
    const left = handle.dataset.panelHandle === 'resize-left';
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !options.canMove() || (resize && minimized))
        return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      gesture = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        bounds: { ...bounds },
        resize,
        left,
      };
      handle.setPointerCapture(event.pointerId);
      panel.classList.add('moving');
    });
    handle.addEventListener('pointermove', (event) => {
      if (!gesture || gesture.pointer !== event.pointerId) return;
      const dx = event.clientX - gesture.x,
        dy = event.clientY - gesture.y;
      const start = gesture.bounds;
      if (gesture.resize) {
        const maxWidth = gesture.left
          ? start.x + start.width - 8
          : innerWidth - start.x - 8;
        const width = Math.max(
          Math.min(320, maxWidth),
          Math.min(maxWidth, start.width + (gesture.left ? -dx : dx)),
        );
        bounds = {
          ...start,
          width,
          x: gesture.left ? start.x + start.width - width : start.x,
          height: Math.min(innerHeight - start.y - 8, start.height + dy),
        };
      } else bounds = { ...start, x: start.x + dx, y: start.y + dy };
      paint();
    });
    const end = () => {
      if (!gesture) return;
      gesture = undefined;
      panel.classList.remove('moving');
      options.save({ ...bounds });
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('lostpointercapture', end);
    handle.addEventListener('keydown', (event) => {
      if (
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
          event.key,
        ) ||
        !options.canMove()
      )
        return;
      event.preventDefault();
      const step = event.shiftKey ? 32 : 8;
      const dx =
        event.key === 'ArrowLeft'
          ? -step
          : event.key === 'ArrowRight'
            ? step
            : 0;
      const dy =
        event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      bounds = resize
        ? { ...bounds, width: bounds.width + dx, height: bounds.height + dy }
        : { ...bounds, x: bounds.x + dx, y: bounds.y + dy };
      paint();
      options.save({ ...bounds });
    });
  }
  window.addEventListener('resize', paint);
  paint();
  return {
    minimize(value: boolean) {
      minimized = value;
      paint();
    },
    dock() {
      bounds.x =
        bounds.x + bounds.width / 2 > innerWidth / 2
          ? 16
          : innerWidth - bounds.width - 16;
      paint();
      options.save({ ...bounds });
    },
    reset() {
      bounds = initial();
      paint();
      options.save({ ...bounds });
    },
  };
}
