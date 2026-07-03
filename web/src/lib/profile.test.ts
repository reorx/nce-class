import { describe, expect, it } from 'vitest';
import { barGeometry, netColor, netLabel } from './profile';

describe('barGeometry', () => {
  it('scales bars against the max magnitude with the zero line at the bottom when all nets ≥ 0', () => {
    const { zero, bars } = barGeometry([2, 4, 0, null], 24);
    expect(zero).toBe(0);
    expect(bars[1]).toEqual({ bottom: 0, height: 24, positive: true });
    expect(bars[0]).toEqual({ bottom: 0, height: 12, positive: true });
    expect(bars[3]).toBeNull(); // absent / 未入班 column has no bar
    // zero still renders a stub so the column doesn't look empty
    expect(bars[2]).toMatchObject({ bottom: 0, positive: true });
    expect(bars[2]!.height).toBeGreaterThan(0);
  });

  it('splits the height across the zero line when nets are mixed', () => {
    const { zero, bars } = barGeometry([3, -1], 24);
    expect(zero).toBe(6); // maxNeg / (maxPos + maxNeg) * H = 1/4 * 24
    expect(bars[0]).toEqual({ bottom: 6, height: 18, positive: true });
    expect(bars[1]).toEqual({ bottom: 0, height: 6, positive: false }); // grows down from the zero line
  });

  it('handles the all-null and all-zero edge cases without dividing by zero', () => {
    expect(barGeometry([null, null], 24).bars).toEqual([null, null]);
    const { zero, bars } = barGeometry([0], 24);
    expect(zero).toBe(0);
    expect(bars[0]!.height).toBeGreaterThan(0);
  });
});

describe('net label + color', () => {
  it('signs positives, keeps the minus, grays out zero', () => {
    expect(netLabel(3)).toBe('+3');
    expect(netLabel(-2)).toBe('-2');
    expect(netLabel(0)).toBe('0');
    expect(netColor(3)).toBe('#2c8a4f');
    expect(netColor(-2)).toBe('#c14a4a');
    expect(netColor(0)).toBe('#9aa1ac');
  });
});
