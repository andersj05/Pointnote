import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountVoiceShortcut } from '../../src/voice-shortcut';

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
