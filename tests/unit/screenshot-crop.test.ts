import { describe, expect, it } from 'vitest';
import { visibleCrop } from '../../src/screenshot-crop';

describe('captured viewport crops', () => {
  it('adds context around a target without losing its original scale', () => {
    expect(
      visibleCrop({ x: 100, y: 50, width: 200, height: 60 }, 1000, 800),
    ).toEqual({
      bounds: { x: 76, y: 26, width: 248, height: 108 },
      clipped: false,
    });
  });
  it('clips partial targets and distinguishes wholly offscreen evidence', () => {
    expect(
      visibleCrop({ x: -50, y: 750, width: 200, height: 200 }, 1000, 800),
    ).toEqual({
      bounds: { x: 0, y: 726, width: 174, height: 74 },
      clipped: true,
    });
    expect(
      visibleCrop({ x: 1000, y: 100, width: 200, height: 100 }, 1000, 800),
    ).toBeUndefined();
  });
});
