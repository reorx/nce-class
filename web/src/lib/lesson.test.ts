import { describe, expect, it } from 'vitest';
import { lessonLabel } from './lesson';

describe('lessonLabel', () => {
  it('joins 课次 and 课题 with a dot', () => {
    expect(lessonLabel(4, 'A private conversation')).toBe('第4课 · A private conversation');
  });

  it('renders either part alone (string 课次 from form inputs coerces)', () => {
    expect(lessonLabel(4, null)).toBe('第4课');
    expect(lessonLabel('4', '')).toBe('第4课');
    expect(lessonLabel(null, 'Too late')).toBe('Too late');
  });

  it('falls back when both are blank', () => {
    expect(lessonLabel(null, null)).toBe('本节课');
    expect(lessonLabel('', '', '')).toBe('');
  });
});
