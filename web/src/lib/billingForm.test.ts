import { describe, expect, it } from 'vitest';
import { parseLessonCount, previewPerStudentCents } from './billingForm';

describe('parseLessonCount', () => {
  it('accepts positive integers (with surrounding whitespace)', () => {
    expect(parseLessonCount('8')).toBe(8);
    expect(parseLessonCount(' 24 ')).toBe(24);
  });

  it('rejects zero, negatives, decimals and non-numbers', () => {
    expect(parseLessonCount('0')).toBeNull();
    expect(parseLessonCount('-3')).toBeNull();
    expect(parseLessonCount('3.5')).toBeNull();
    expect(parseLessonCount('abc')).toBeNull();
    expect(parseLessonCount('')).toBeNull();
    expect(parseLessonCount('  ')).toBeNull();
  });
});

describe('previewPerStudentCents (全勤口径预售金额)', () => {
  it('is count × price + addon', () => {
    expect(previewPerStudentCents({ lessonCount: 8, unitPriceCents: 10000, addonCents: 3000 })).toBe(83000);
  });

  it('is null when any input is missing', () => {
    expect(previewPerStudentCents({ lessonCount: null, unitPriceCents: 10000, addonCents: 0 })).toBeNull();
    expect(previewPerStudentCents({ lessonCount: 8, unitPriceCents: null, addonCents: 0 })).toBeNull();
    expect(previewPerStudentCents({ lessonCount: 8, unitPriceCents: 10000, addonCents: null })).toBeNull();
  });
});
