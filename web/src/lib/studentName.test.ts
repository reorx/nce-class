import { describe, expect, it } from 'vitest';
import { studentNamePair, validateStudentNameForm } from './studentName';

describe('validateStudentNameForm', () => {
  it('trims both fields', () => {
    expect(validateStudentNameForm({ name: '  Lucy ', cnName: ' 露西 ' })).toEqual({ name: 'Lucy', cnName: '露西' });
  });

  it('rejects a blank 英文名', () => {
    expect(validateStudentNameForm({ name: '   ', cnName: '露西' })).toEqual({ error: '学生姓名必填' });
  });

  it('turns a blank 中文名 into null (清空)', () => {
    expect(validateStudentNameForm({ name: 'Lucy', cnName: '   ' })).toEqual({ name: 'Lucy', cnName: null });
    expect(validateStudentNameForm({ name: 'Lucy', cnName: '' })).toEqual({ name: 'Lucy', cnName: null });
  });
});

describe('studentNamePair', () => {
  it('returns the 中文名 as the secondary line', () => {
    expect(studentNamePair({ name: 'Lucy', cnName: '露西' })).toEqual({ primary: 'Lucy', secondary: '露西' });
  });

  it('has no secondary line when 中文名 is missing, null or blank', () => {
    expect(studentNamePair({ name: 'Lucy' }).secondary).toBeNull();
    expect(studentNamePair({ name: 'Lucy', cnName: null }).secondary).toBeNull();
    expect(studentNamePair({ name: 'Lucy', cnName: '  ' }).secondary).toBeNull();
  });

  it('drops a 中文名 identical to the 英文名 (no "Tom · Tom")', () => {
    expect(studentNamePair({ name: '浩浩', cnName: '浩浩' }).secondary).toBeNull();
    expect(studentNamePair({ name: 'Tom', cnName: ' Tom ' }).secondary).toBeNull();
  });
});
