import { describe, expect, it } from 'vitest';
import {
  BOOK_LABELS,
  BOOK_LESSON_COUNTS,
  BOOKS,
  type BookKey,
  clampLesson,
  fmtDateCn,
  lessonOptions,
  parseBook,
  renderHomeworkTemplate,
  reviewLessonLabel,
} from './homework';

describe('BOOKS', () => {
  it('lists 青少版A/B before 第一~四册, each with a label and a lesson count', () => {
    expect(BOOKS).toEqual(['starterA', 'starterB', '1', '2', '3', '4']);
    expect(BOOKS.map((b) => BOOK_LABELS[b])).toEqual(['青少版A', '青少版B', '第一册', '第二册', '第三册', '第四册']);
    expect(BOOKS.map((b) => BOOK_LESSON_COUNTS[b])).toEqual([45, 45, 144, 96, 60, 48]);
  });
});

describe('parseBook', () => {
  it('maps a <select> value to its book key', () => {
    expect(parseBook('starterA')).toBe('starterA');
    expect(parseBook('starterB')).toBe('starterB');
    expect(parseBook('1')).toBe('1');
    expect(parseBook('4')).toBe('4');
  });

  it('未设置 or an unknown value → null (never NaN)', () => {
    expect(parseBook('')).toBeNull();
    for (const v of ['0', '5', '1.5', 'starterC', 'StarterA', 'Starter A']) {
      expect(parseBook(v)).toBeNull();
    }
  });
});

describe('lessonOptions', () => {
  it('lists 1..count for each book', () => {
    expect(lessonOptions('2')).toHaveLength(96);
    expect(lessonOptions('2')[0]).toBe(1);
    expect(lessonOptions('2')[95]).toBe(96);
    expect(lessonOptions('4')).toHaveLength(48);
    expect(lessonOptions('starterA')).toHaveLength(45);
    expect(lessonOptions('starterB')[44]).toBe(45);
  });

  it('returns [] without a book', () => {
    expect(lessonOptions(null)).toEqual([]);
    expect(lessonOptions('9' as BookKey)).toEqual([]);
  });
});

describe('clampLesson', () => {
  it('keeps an in-range lesson', () => {
    expect(clampLesson('1', 144)).toBe(144);
    expect(clampLesson('3', 7)).toBe(7);
    expect(clampLesson('starterA', 8)).toBe(8);
  });

  it('clamps out-of-range lessons into 1..count', () => {
    expect(clampLesson('1', 0)).toBe(1);
    expect(clampLesson('1', 145)).toBe(144);
    expect(clampLesson('4', 96)).toBe(BOOK_LESSON_COUNTS['4']);
    expect(clampLesson('starterB', 99)).toBe(45);
  });

  it('null book or lesson → null', () => {
    expect(clampLesson(null, 7)).toBeNull();
    expect(clampLesson('2', null)).toBeNull();
    expect(clampLesson('9' as BookKey, 7)).toBeNull();
  });
});

describe('reviewLessonLabel', () => {
  it('青少版 lessons read as Unit · Lesson (3 lessons per unit)', () => {
    expect(reviewLessonLabel('starterA', 1)).toBe('Unit 1 · Lesson 1');
    expect(reviewLessonLabel('starterA', 3)).toBe('Unit 1 · Lesson 3');
    expect(reviewLessonLabel('starterA', 8)).toBe('Unit 3 · Lesson 2');
    expect(reviewLessonLabel('starterB', 45)).toBe('Unit 15 · Lesson 3');
  });

  it('第一~四册 lessons read as 第N课', () => {
    expect(reviewLessonLabel('2', 7)).toBe('第7课');
    expect(reviewLessonLabel('1', 144)).toBe('第144课');
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
