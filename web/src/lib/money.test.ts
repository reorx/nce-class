import { describe, expect, it } from 'vitest';
import { centsToYuan, fmtMoney, yuanToCents } from './money';

describe('centsToYuan', () => {
  it('renders whole yuan without decimals', () => {
    expect(centsToYuan(10000)).toBe('100');
    expect(centsToYuan(0)).toBe('0');
  });

  it('trims trailing zero but keeps meaningful cents', () => {
    expect(centsToYuan(9950)).toBe('99.5');
    expect(centsToYuan(9955)).toBe('99.55');
    expect(centsToYuan(3)).toBe('0.03');
  });
});

describe('yuanToCents', () => {
  it('parses integers and up-to-2-decimal amounts', () => {
    expect(yuanToCents('120')).toBe(12000);
    expect(yuanToCents('99.5')).toBe(9950);
    expect(yuanToCents('99.55')).toBe(9955);
    expect(yuanToCents(' 0 ')).toBe(0);
  });

  it('rejects blank, negative, >2 decimals and garbage', () => {
    expect(yuanToCents('')).toBeNull();
    expect(yuanToCents('  ')).toBeNull();
    expect(yuanToCents('-1')).toBeNull();
    expect(yuanToCents('99.999')).toBeNull();
    expect(yuanToCents('abc')).toBeNull();
    expect(yuanToCents('1,000')).toBeNull();
  });

  it('round-trips with centsToYuan', () => {
    for (const cents of [0, 3, 9950, 9955, 12000, 1234567]) {
      expect(yuanToCents(centsToYuan(cents))).toBe(cents);
    }
  });
});

describe('fmtMoney', () => {
  it('prefixes ¥ and groups thousands', () => {
    expect(fmtMoney(1372000)).toBe('¥13,720');
    expect(fmtMoney(108000)).toBe('¥1,080');
    expect(fmtMoney(9950)).toBe('¥99.5');
    expect(fmtMoney(0)).toBe('¥0');
  });
});
