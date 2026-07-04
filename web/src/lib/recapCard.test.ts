import { describe, expect, it } from 'vitest';
import {
  dateLabel,
  fmtDurationCn,
  fmtSigned,
  groupBars,
  homeworkTone,
  podium,
  recitationTone,
  toneColor,
} from './recapCard';

describe('podium', () => {
  it('places the winner in the center, others alternating left/right', () => {
    expect(podium([1, 2, 3])).toEqual([2, 1, 3]);
    expect(podium([1, 2, 3, 4, 5])).toEqual([4, 2, 1, 3, 5]);
  });
  it('handles trivial sizes', () => {
    expect(podium([])).toEqual([]);
    expect(podium([1])).toEqual([1]);
    expect(podium([1, 2])).toEqual([2, 1]);
  });
});

describe('groupBars', () => {
  const g = (name: string, score: number, orderIndex = 0) => ({ name, emoji: '🦁', orderIndex, score });

  it('marks top-score groups as winners and arranges them podium-style', () => {
    const bars = groupBars([g('海豚组', 10, 0), g('狮子组', 12, 1), g('狐狸组', 9, 2)]);
    expect(bars.map((b) => b.name)).toEqual(['海豚组', '狮子组', '狐狸组']); // 2nd, 1st, 3rd
    expect(bars.map((b) => b.winner)).toEqual([false, true, false]);
  });

  it('gives the winner the tallest bar and scales the rest by score', () => {
    const bars = groupBars([g('a', 12), g('b', 10), g('c', 9)]);
    const byName = new Map(bars.map((b) => [b.name, b]));
    expect(byName.get('a')!.height).toBe(92);
    expect(byName.get('b')!.height).toBeGreaterThan(byName.get('c')!.height);
    expect(byName.get('c')!.height).toBeGreaterThanOrEqual(36);
    expect(byName.get('b')!.height).toBeLessThan(92);
  });

  it('treats ties for first place as co-winners', () => {
    const bars = groupBars([g('a', 5), g('b', 5)]);
    expect(bars.every((b) => b.winner && b.height === 92)).toBe(true);
  });

  it('survives all-zero and negative scores', () => {
    const bars = groupBars([g('a', 0), g('b', -2)]);
    expect(bars.find((b) => b.name === 'a')!.winner).toBe(true);
    for (const b of bars) expect(b.height).toBeGreaterThanOrEqual(36);
  });

  it('breaks score ties by orderIndex (stable)', () => {
    const bars = groupBars([g('later', 3, 2), g('earlier', 3, 1), g('top', 8, 0)]);
    // sorted desc: top, earlier, later → podium: [earlier, top, later]
    expect(bars.map((b) => b.name)).toEqual(['earlier', 'top', 'later']);
  });
});

describe('formatting', () => {
  it('fmtDurationCn', () => {
    expect(fmtDurationCn(112)).toBe('1小时52分');
    expect(fmtDurationCn(60)).toBe('1小时');
    expect(fmtDurationCn(45)).toBe('45分钟');
    expect(fmtDurationCn(0)).toBe('0分钟');
  });

  it('dateLabel joins year and MM-DD with dots', () => {
    expect(dateLabel('2026', '07-03')).toBe('2026.07.03');
    expect(dateLabel(null, '07-03')).toBe('07.03');
  });

  it('fmtSigned', () => {
    expect(fmtSigned(4)).toBe('+4');
    expect(fmtSigned(-2)).toBe('-2');
    expect(fmtSigned(0)).toBe('0');
  });
});

describe('check-status tones', () => {
  it('homework: 完成 good, 需补 part, anything else muted', () => {
    expect(homeworkTone('完成')).toBe('good');
    expect(homeworkTone('需补')).toBe('part');
    expect(homeworkTone('没交')).toBe('muted');
  });
  it('recitation maps all four states', () => {
    expect(recitationTone('已背完')).toBe('good');
    expect(recitationTone('背完部分')).toBe('part');
    expect(recitationTone('没背')).toBe('bad');
    expect(recitationTone('未检查')).toBe('muted');
  });
  it('every tone has a color', () => {
    for (const t of ['good', 'part', 'bad', 'muted'] as const) expect(toneColor(t)).toMatch(/^#/);
  });
});
