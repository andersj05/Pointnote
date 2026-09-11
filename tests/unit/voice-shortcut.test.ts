import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountVoiceShortcut } from '../../src/voice-shortcut';
import {
  backtickShortcut,
  keyShortcut,
  shortcutLabel,
  validShortcut,
} from '../../src/shortcut-config';

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

function setup() {
  let enabled = true;
  const start = vi.fn();
  const release = vi.fn();
  cleanup = mountVoiceShortcut({ enabled: () => enabled, start, release });
  return { start, release, disable: () => (enabled = false) };
}
function dispatch(type: string, button = 1, buttons = 0) {
  const event = new MouseEvent(type, { button, buttons, cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('middle mouse hold shortcut', () => {
  it('supports a backtick hold without key-repeat restarts and releases after disabling', () => {
    const start = vi.fn(),
      release = vi.fn();
    let enabled = true;
    cleanup = mountVoiceShortcut({
      enabled: () => enabled,
      start,
      release,
      binding: () => backtickShortcut,
    });
    const key = (type: string, repeat = false) => {
      const event = new KeyboardEvent(type, {
        code: 'Backquote',
        key: '`',
        repeat,
        cancelable: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(key('keydown')).toBe(true);
    expect(key('keydown', true)).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    enabled = false;
    expect(key('keyup')).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('does not intercept typing or IME composition', () => {
    const start = vi.fn();
    cleanup = mountVoiceShortcut({
      enabled: () => true,
      start,
      release: vi.fn(),
      binding: () => backtickShortcut,
    });
    const input = document.createElement('textarea');
    document.body.append(input);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'Backquote',
        key: '`',
        bubbles: true,
        composed: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'Backquote',
        key: '`',
        isComposing: true,
      }),
    );
    expect(start).not.toHaveBeenCalled();
    input.remove();
  });
  it('supports mouse back without navigating and stops on lost release', () => {
    const start = vi.fn(),
      release = vi.fn();
    cleanup = mountVoiceShortcut({
      enabled: () => true,
      start,
      release,
      binding: () => ({ kind: 'mouse', button: 3 }),
    });
    expect(dispatch('pointerdown', 3, 8)).toBe(true);
    expect(dispatch('mouseup', 3)).toBe(true);
    expect(dispatch('auxclick', 3)).toBe(true);
    expect(start).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
  it('validates saved bindings and captures modifier combinations', () => {
    expect(validShortcut({ kind: 'mouse', button: 0 })).toBe(false);
    expect(validShortcut({ ...backtickShortcut, code: 'Escape' })).toBe(false);
    const binding = keyShortcut(
      new KeyboardEvent('keydown', {
        code: 'KeyV',
        key: 'v',
        ctrlKey: true,
        altKey: true,
      }),
    );
    expect(binding).toBeDefined();
    expect(shortcutLabel(binding)).toBe('Ctrl + Alt + V');
  });
  it('records once and consumes autoscroll and the trailing link click', () => {
    const { start, release } = setup();
    expect(dispatch('pointerdown')).toBe(true);
    expect(dispatch('mousedown')).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(dispatch('pointerup')).toBe(true);
    expect(dispatch('mouseup')).toBe(true);
    expect(dispatch('auxclick')).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('leaves normal middle, left and right clicks alone when inactive', () => {
    const { start, disable } = setup();
    for (const button of [0, 2])
      expect(dispatch('pointerdown', button)).toBe(false);
    disable();
    for (const type of [
      'pointerdown',
      'mousedown',
      'pointerup',
      'mouseup',
      'auxclick',
    ])
      expect(dispatch(type)).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
  it('releases and consumes the completed gesture if disabled while held', () => {
    const { release, disable } = setup();
    dispatch('pointerdown');
    disable();
    expect(dispatch('pointerup')).toBe(true);
    expect(dispatch('auxclick')).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(dispatch('pointerdown')).toBe(false);
  });
  it.each(['blur', 'pointercancel', 'pointermove'])(
    'stops after %s even when no middle-button release arrives',
    (type) => {
      const { release } = setup();
      dispatch('pointerdown');
      dispatch('pointermove', -1, 4);
      expect(release).not.toHaveBeenCalled();
      dispatch(type, -1, 0);
      expect(release).toHaveBeenCalledTimes(1);
    },
  );
});
