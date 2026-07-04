import { describe, expect, it } from 'vitest';
import { MAX_TAG_LEN, mergeTagOptions, normalizeTagName, tagKey } from './tags';

describe('normalizeTagName', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normalizeTagName('  听写全对  ')).toBe('听写全对');
    expect(normalizeTagName('空白   归一化')).toBe('空白 归一化');
    expect(normalizeTagName('\t默写\n全对 ')).toBe('默写 全对');
  });

  it('caps the length at MAX_TAG_LEN (server mirrors this)', () => {
    expect(normalizeTagName('x'.repeat(40))).toBe('x'.repeat(MAX_TAG_LEN));
  });

  it('re-trims after the cut so no trailing space survives truncation', () => {
    expect(normalizeTagName('a'.repeat(19) + ' bc')).toBe('a'.repeat(19));
  });

  it('cuts by code point, never splitting an emoji surrogate pair', () => {
    expect(normalizeTagName('🏅'.repeat(25))).toBe('🏅'.repeat(MAX_TAG_LEN));
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeTagName('   ')).toBe('');
    expect(normalizeTagName('')).toBe('');
  });
});

describe('tagKey', () => {
  it('folds ASCII case (matches the server NOCASE index); CJK unaffected', () => {
    expect(tagKey('Star')).toBe(tagKey('star'));
    expect(tagKey('听写全对')).toBe('听写全对');
  });

  it('normalises before keying, so whitespace variants collide', () => {
    expect(tagKey(' 空白  归一化 ')).toBe(tagKey('空白 归一化'));
  });
});

describe('mergeTagOptions', () => {
  it('unions the org library with local session tags, deduped case-insensitively', () => {
    expect(mergeTagOptions(['听写全对', 'Star'], ['star', '默写全对'])).toEqual(
      ['听写全对', 'Star', '默写全对'].sort((a, b) => a.localeCompare(b, 'zh')),
    );
  });

  it('drops blanks and keeps the first spelling of a duplicate', () => {
    const merged = mergeTagOptions(['  ', 'Star'], ['STAR']);
    expect(merged).toEqual(['Star']);
  });

  it('is empty when both sources are empty', () => {
    expect(mergeTagOptions([], [])).toEqual([]);
  });
});
