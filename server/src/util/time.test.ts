import { describe, expect, it } from 'vitest';
import { localToday } from './time.js';

// 生产容器默认 UTC，「今天」必须按东八区切日，不能跟着进程时区走。
describe('localToday', () => {
  it('北京时间 0–8 点（UTC 仍是前一天）返回北京日期', () => {
    expect(localToday(new Date('2026-09-27T16:00:00Z'))).toBe('2026-09-28');
    expect(localToday(new Date('2026-09-27T23:59:59Z'))).toBe('2026-09-28');
  });

  it('北京时间 8 点之后与 UTC 同一天', () => {
    expect(localToday(new Date('2026-09-28T00:00:00Z'))).toBe('2026-09-28');
    expect(localToday(new Date('2026-09-28T15:59:59Z'))).toBe('2026-09-28');
  });

  it('跨月跨年按北京日期进位', () => {
    expect(localToday(new Date('2026-09-30T16:30:00Z'))).toBe('2026-10-01');
    expect(localToday(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
  });

  it('不受进程时区影响', () => {
    const prev = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    expect(localToday(new Date('2026-09-27T17:00:00Z'))).toBe('2026-09-28');
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  });
});
