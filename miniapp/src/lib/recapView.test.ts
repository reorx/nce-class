import { describe, expect, it } from 'vitest';
import { fmtScore, homeworkTone, medals, recitationTone } from './recapView';

describe('medals', () => {
  it('前三名发奖牌，第四名起为空', () => {
    expect(medals([15, 12, 9, 7])).toEqual(['🥇', '🥈', '🥉', '']);
  });
  it('并列共享名次', () => {
    expect(medals([10, 10, 8])).toEqual(['🥇', '🥇', '🥉']);
  });
  it('单组也有金牌', () => {
    expect(medals([3])).toEqual(['🥇']);
  });
});

describe('status tones（PRD §8 配色口径）', () => {
  it('作业：完成=绿，需补=黄，其余=灰', () => {
    expect(homeworkTone('完成')).toBe('good');
    expect(homeworkTone('需补')).toBe('part');
    expect(homeworkTone('没交')).toBe('muted');
  });
  it('背书：已背完/背完部分/没背/未检查 → 绿/黄/红/灰', () => {
    expect(recitationTone('已背完')).toBe('good');
    expect(recitationTone('背完部分')).toBe('part');
    expect(recitationTone('没背')).toBe('bad');
    expect(recitationTone('未检查')).toBe('muted');
  });
});

describe('fmtScore', () => {
  it('正分带 +⭐，负分原样，零无符号', () => {
    expect(fmtScore(2)).toBe('+2⭐');
    expect(fmtScore(-1)).toBe('-1');
    expect(fmtScore(0)).toBe('0');
  });
});
