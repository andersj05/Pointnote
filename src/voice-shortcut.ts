// Capture before the page-selection shield so the same gesture works over both
// the page and the panel, including text-range mode.
export function mountVoiceShortcut(options: {
  enabled: () => boolean;
  start: () => void;
  release: () => void;
}) {
  let held = false;
  let claimed = false;
  const suppress = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const release = () => {
    if (held) options.release();
    held = false;
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 1) return;
    claimed = options.enabled();
    if (!claimed) return;
    suppress(event);
    held = true;
    options.start();
  };
  const up = (event: PointerEvent) => {
    if (event.button !== 1 || !claimed) return;
    suppress(event);
    release();
  };
  const mouse = (event: MouseEvent) => {
    if (event.button !== 1 || !claimed) return;
    // Cancel autoscroll/paste on mousedown and link opening on auxclick, even
    // if selection was paused or the panel closed before the button released.
    suppress(event);
    if (event.type === 'mouseup') release();
    if (event.type === 'auxclick') claimed = false;
  };
  const move = (event: PointerEvent) => {
    if (held && !(event.buttons & 4)) release();
  };
  const cancel = () => {
    release();
    claimed = false;
  };
  const visibility = () => {
    if (document.hidden) cancel();
  };
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointercancel', cancel, true);
  for (const type of ['mousedown', 'mouseup', 'auxclick'])
    window.addEventListener(type, mouse as EventListener, true);
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    cancel();
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointercancel', cancel, true);
    for (const type of ['mousedown', 'mouseup', 'auxclick'])
      window.removeEventListener(type, mouse as EventListener, true);
    window.removeEventListener('blur', cancel);
    document.removeEventListener('visibilitychange', visibility);
  };
}
