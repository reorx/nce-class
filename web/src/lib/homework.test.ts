import { describe, expect, it } from 'vitest';
import { BOOK_LESSON_COUNTS, clampLesson, fmtDateCn, lessonOptions, renderHomeworkTemplate } from './homework';

describe('lessonOptions', () => {
  it('lists 1..count for each book', () => {
    expect(lessonOptions(2)).toHaveLength(96);
    expect(lessonOptions(2)[0]).toBe(1);
    expect(lessonOptions(2)[95]).toBe(96);
    expect(lessonOptions(4)).toHaveLength(48);
  });

  it('returns [] without a book', () => {
    expect(lessonOptions(null)).toEqual([]);
    expect(lessonOptions(9)).toEqual([]);
  });
});

describe('clampLesson', () => {
  it('keeps an in-range lesson', () => {
    expect(clampLesson(1, 144)).toBe(144);
    expect(clampLesson(3, 7)).toBe(7);
  });

  it('clamps out-of-range lessons into 1..count', () => {
    expect(clampLesson(1, 0)).toBe(1);
    expect(clampLesson(1, 145)).toBe(144);
    expect(clampLesson(4, 96)).toBe(BOOK_LESSON_COUNTS[4]);
  });

  it('null book or lesson → null', () => {
    expect(clampLesson(null, 7)).toBeNull();
    expect(clampLesson(2, null)).toBeNull();
    expect(clampLesson(9, 7)).toBeNull();
  });
});

describe('fmtDateCn', () => {
  it("turns 'MM-DD' into 中文日期 without leading zeros", () => {
    expect(fmtDateCn('07-04')).toBe('7月4日');
    expect(fmtDateCn('12-31')).toBe('12月31日');
  });

  it('passes malformed input through untouched', () => {
    expect(fmtDateCn('2026-07-04')).toBe('2026-07-04');
    expect(fmtDateCn('')).toBe('');
  });
});

describe('renderHomeworkTemplate', () => {
  const vars = { lessonNumber: 7, date: '07-04', className: '三年级A班' };

  it('substitutes all variables, including repeats', () => {
    const tpl = '- L{lesson_number} 三英一汉，听写三遍\n- 练字三面\n- 背L{lesson_number}';
    expect(renderHomeworkTemplate(tpl, vars)).toBe('- L7 三英一汉，听写三遍\n- 练字三面\n- 背L7');
    expect(renderHomeworkTemplate('{class_name} {date}', vars)).toBe('三年级A班 7月4日');
  });

  it("missing lessonNumber renders '' rather than 'null'", () => {
    expect(renderHomeworkTemplate('背L{lesson_number}', { ...vars, lessonNumber: null })).toBe('背L');
  });

  it('leaves unknown placeholders intact', () => {
    expect(renderHomeworkTemplate('{other} L{lesson_number}', vars)).toBe('{other} L7');
  });
});
