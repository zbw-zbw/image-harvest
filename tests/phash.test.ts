// Unit tests for the pure helpers in shared/phash.
// calculatePHash itself requires Canvas + Image; not unit-tested here.

import { describe, it, expect } from 'vitest';
import { hammingDistance, areSimilar } from '../shared/phash';

describe('hammingDistance', () => {
  it('counts differing bits between equal-length strings', () => {
    expect(hammingDistance('0000', '0000')).toBe(0);
    expect(hammingDistance('0000', '1111')).toBe(4);
    expect(hammingDistance('1010', '1001')).toBe(2);
  });

  it('returns Infinity when either input is null', () => {
    expect(hammingDistance(null, '0000')).toBe(Infinity);
    expect(hammingDistance('0000', null)).toBe(Infinity);
    expect(hammingDistance(null, null)).toBe(Infinity);
  });

  it('returns Infinity when lengths differ', () => {
    expect(hammingDistance('000', '0000')).toBe(Infinity);
  });
});

describe('areSimilar', () => {
  it('uses default threshold of 5', () => {
    expect(areSimilar('00000000', '11110000')).toBe(true);
    expect(areSimilar('00000000', '11111100')).toBe(false);
  });

  it('respects an explicit threshold', () => {
    expect(areSimilar('00000000', '11000000', 1)).toBe(false);
    expect(areSimilar('00000000', '11000000', 2)).toBe(true);
  });

  it('returns false (Infinity > threshold) for null inputs', () => {
    expect(areSimilar(null, '0000')).toBe(false);
    expect(areSimilar('0000', null, 100)).toBe(false);
  });
});
