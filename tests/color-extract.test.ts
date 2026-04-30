// Unit tests for the pure helpers in shared/color-extract.
// extractColors itself requires Canvas + Image; not unit-tested here.

import { describe, it, expect } from 'vitest';
import { rgbToHex, hexToRgb } from '../shared/color-extract';

describe('rgbToHex', () => {
  it('converts pure colors', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
    expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
  });

  it('zero-pads single-hex digits', () => {
    expect(rgbToHex(1, 2, 3)).toBe('#010203');
  });

  it('rounds float channel values', () => {
    expect(rgbToHex(0.4, 0.6, 254.5)).toBe('#0001ff');
  });
});

describe('hexToRgb', () => {
  it('parses six-digit hex with leading #', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#abcdef')).toEqual({ r: 0xab, g: 0xcd, b: 0xef });
  });

  it('parses six-digit hex without leading #', () => {
    expect(hexToRgb('ff8800')).toEqual({ r: 255, g: 136, b: 0 });
  });

  it('is case-insensitive', () => {
    expect(hexToRgb('#ABCDEF')).toEqual({ r: 0xab, g: 0xcd, b: 0xef });
  });

  it('returns black for invalid input', () => {
    expect(hexToRgb('not-a-hex')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#fff')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('rgbToHex/hexToRgb roundtrip', () => {
  it('round-trips integer RGB values', () => {
    for (const [r, g, b] of [[12, 34, 56], [200, 150, 100], [0, 0, 1], [255, 254, 253]]) {
      expect(hexToRgb(rgbToHex(r, g, b))).toEqual({ r, g, b });
    }
  });
});
