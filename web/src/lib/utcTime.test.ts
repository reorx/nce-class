import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { utcToLocalDate, utcToLocalMinute } from './utcTime';

// 服务端 datetime('now') 写入的是 UTC 'YYYY-MM-DD HH:MM:SS'，显示时要换成浏览器本地时间。
let prevTZ: string | undefined;
beforeEach(() => {
  prevTZ = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
});
afterEach(() => {
  if (prevTZ === undefined) delete process.env.TZ;
  else process.env.TZ = prevTZ;
});

describe('utcToLocalMinute', () => {
  it('下午 3 点确认收款，显示 15:xx 而不是 07:xx', () => {
    expect(utcToLocalMinute('2026-09-28 07:05:42')).toBe('09-28 15:05');
  });

  it('北京时间 0–8 点的操作显示为当天，不落在前一天', () => {
    expect(utcToLocalMinute('2026-09-27 17:30:00')).toBe('09-28 01:30');
  });

  it('跟随浏览器所在时区', () => {
    process.env.TZ = 'UTC';
    expect(utcToLocalMinute('2026-09-28 07:05:42')).toBe('09-28 07:05');
  });
});

describe('utcToLocalDate', () => {
  it('返回本地日期 YYYY-MM-DD', () => {
    expect(utcToLocalDate('2026-09-27 17:30:00')).toBe('2026-09-28');
    expect(utcToLocalDate('2026-12-31 16:00:00')).toBe('2027-01-01');
    expect(utcToLocalDate('2026-09-28 10:00:00')).toBe('2026-09-28');
  });
});
