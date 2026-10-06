import { describe, expect, it } from 'vitest';
import { billingClassSelection, parseLessonCount, previewPerStudentCents } from './billingForm';

describe('创建收款项的班级选择', () => {
  const classes = [{ id: 'old', isArchived: true }, { id: 'a', isArchived: false }, { id: 'b', isArchived: false }];

  it('仅列出未归档班级，并默认选择第一个', () => {
    expect(billingClassSelection(classes, '')).toEqual({ classes: classes.slice(1), classId: 'a' });
  });

  it('保留有效选择，原班级归档或删除后回退', () => {
    expect(billingClassSelection(classes, 'b').classId).toBe('b');
    expect(billingClassSelection(classes, 'old').classId).toBe('a');
    expect(billingClassSelection(classes, 'deleted').classId).toBe('a');
  });

  it('没有未归档班级时清空选择', () => {
    expect(billingClassSelection(classes.slice(0, 1), 'old')).toEqual({ classes: [], classId: '' });
    expect(billingClassSelection([], 'a')).toEqual({ classes: [], classId: '' });
  });
});

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

describe('previewPerStudentCents (每人应收)', () => {
  it('is count × price + addon', () => {
    expect(previewPerStudentCents({ lessonCount: 8, unitPriceCents: 10000, addonCents: 3000 })).toBe(83000);
  });

  it('is null when any input is missing', () => {
    expect(previewPerStudentCents({ lessonCount: null, unitPriceCents: 10000, addonCents: 0 })).toBeNull();
    expect(previewPerStudentCents({ lessonCount: 8, unitPriceCents: null, addonCents: 0 })).toBeNull();
    expect(previewPerStudentCents({ lessonCount: 8, unitPriceCents: 10000, addonCents: null })).toBeNull();
  });
});
