import { defaultShortcut, type VoiceShortcut } from './shortcut-config';
// Capture before the page-selection shield so the same gesture works over both
// the page and the panel, including text-range mode.
export function mountVoiceShortcut(options: {
  enabled: () => boolean;
  start: () => void;
  release: () => void;
  binding?: () => VoiceShortcut;
}) {
  let held = false;
  let claimed = false;
  let mouseButton = 1;
  let activeKey: string | undefined;
  const binding = () => options.binding?.() || defaultShortcut;
  const suppress = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const release = () => {
    if (held) options.release();
    held = false;
  };
  const down = (event: PointerEvent) => {
    const shortcut = binding();
    if (shortcut.kind !== 'mouse' || event.button !== shortcut.button) return;
    mouseButton = shortcut.button;
    claimed = options.enabled();
    if (!claimed) return;
    suppress(event);
    held = true;
    options.start();
  };
  const up = (event: PointerEvent) => {
    if (event.button !== mouseButton || !claimed) return;
    suppress(event);
    release();
  };
  const mouse = (event: MouseEvent) => {
    if (event.button !== mouseButton || !claimed) return;
    // Cancel autoscroll/paste on mousedown and link opening on auxclick, even
    // if selection was paused or the panel closed before the button released.
    suppress(event);
    if (event.type === 'mouseup') release();
    if (event.type === 'auxclick') claimed = false;
  };
  const move = (event: PointerEvent) => {
    if (
      held &&
      !activeKey &&
      !(event.buttons & (mouseButton === 1 ? 4 : mouseButton === 3 ? 8 : 16))
    )
      release();
  };
  const cancel = () => {
    release();
    claimed = false;
    activeKey = undefined;
  };
  const visibility = () => {
    if (document.hidden) cancel();
  };
  const keydown = (event: KeyboardEvent) => {
    const shortcut = binding();
    if (
      shortcut.kind !== 'key' ||
      event.isComposing ||
      event.code !== shortcut.code ||
      event.ctrlKey !== shortcut.ctrl ||
      event.altKey !== shortcut.alt ||
      event.shiftKey !== shortcut.shift ||
      event.metaKey !== shortcut.meta
    )
      return;
    if (activeKey === event.code) {
      suppress(event);
      return;
    }
    if (
      !options.enabled() ||
      event.repeat ||
      event
        .composedPath()
        .some(
          (target) =>
            target instanceof HTMLElement &&
            (target.matches('input,textarea,select,button,[role="textbox"]') ||
              target.isContentEditable),
        )
    )
      return;
    suppress(event);
    activeKey = event.code;
    held = true;
    options.start();
  };
  const keyup = (event: KeyboardEvent) => {
    if (!activeKey) return;
    if (
      event.code !== activeKey &&
      !['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)
    )
      return;
    suppress(event);
    release();
    activeKey = undefined;
  };
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('keyup', keyup, true);
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
    window.removeEventListener('keydown', keydown, true);
    window.removeEventListener('keyup', keyup, true);
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
