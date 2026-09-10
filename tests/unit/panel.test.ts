import { describe, expect, it } from 'vitest';
import { fitPanel } from '../../src/panel';

describe('panel viewport recovery', () => {
  it('recovers a saved layout from a larger display', () => {
    const result = fitPanel(
      { x: 2100, y: 900, width: 600, height: 900 },
      { width: 1280, height: 720 },
    );
    expect(result).toEqual({ x: 672, y: 8, width: 600, height: 704 });
  });
  it('keeps the entire panel reachable on narrow windows', () => {
    const result = fitPanel(
      { x: -400, y: -100, width: 390, height: 800 },
      { width: 300, height: 360 },
    );
    expect(result).toEqual({ x: 8, y: 8, width: 284, height: 344 });
  });
  it('preserves a valid user layout and enforces a usable minimum size', () => {
    const viewport = { width: 1440, height: 1000 };
    const valid = { x: 150, y: 75, width: 420, height: 650 };
    expect(fitPanel(valid, viewport)).toEqual(valid);
    expect(fitPanel({ ...valid, width: 50, height: 100 }, viewport)).toEqual({
      ...valid,
      width: 320,
      height: 380,
    });
  });
});
