import { describe, expect, it } from 'vitest';
import { relativeSessionLabel } from './relativeTime';

// now 固定为 2026-07-11 14:00:00（本地时间）
const now = new Date(2026, 6, 11, 14, 0, 0);

describe('relativeSessionLabel', () => {
  it('今天的课按小时级显示', () => {
    expect(relativeSessionLabel('2026-07-11 11:00:00', now)).toBe('3小时前');
    expect(relativeSessionLabel('2026-07-11 13:00:00', now)).toBe('1小时前');
  });

  it('今天不足 1 小时显示「刚刚」', () => {
    expect(relativeSessionLabel('2026-07-11 13:30:00', now)).toBe('刚刚');
    expect(relativeSessionLabel('2026-07-11 14:00:00', now)).toBe('刚刚');
  });

  it('未来时间（编辑课堂改出来的）也兜底为「刚刚」', () => {
    expect(relativeSessionLabel('2026-07-11 15:00:00', now)).toBe('刚刚');
  });

  it('昨天按自然日算，即使距今不足 24 小时', () => {
    // 现在是 07-11 凌晨 1 点，昨晚 23:30 的课 → 「昨天」而非「1小时前」
    const earlyMorning = new Date(2026, 6, 11, 1, 0, 0);
    expect(relativeSessionLabel('2026-07-10 23:30:00', earlyMorning)).toBe('昨天');
    expect(relativeSessionLabel('2026-07-10 19:00:00', now)).toBe('昨天');
  });

  it('更早的按自然日差显示天数', () => {
    expect(relativeSessionLabel('2026-07-09 19:00:00', now)).toBe('2天前');
    expect(relativeSessionLabel('2026-07-01 19:00:00', now)).toBe('10天前');
  });

  it('跨月自然日差正确', () => {
    expect(relativeSessionLabel('2026-06-30 19:00:00', now)).toBe('11天前');
  });

  it('缺 startedAt（legacy 数据）返回 null', () => {
    expect(relativeSessionLabel(null, now)).toBe(null);
    expect(relativeSessionLabel('', now)).toBe(null);
  });
});
