import { describe, expect, it } from 'vitest';
import type { Recap, RecapGroup, RecapMember } from './api';
import {
  absentText,
  groupCards,
  homeworkStyle,
  paletteFor,
  podiumStars,
  recitationStyle,
  statSections,
  ungroupedNote,
} from './recapV3';

const mem = (name: string, over: Partial<RecapMember> = {}): RecapMember => ({
  name,
  attendance: 'present',
  score: 0,
  recitation: null,
  homework: null,
  warns: 0,
  ...over,
});

const grp = (name: string, over: Partial<RecapGroup> = {}): RecapGroup => ({
  name,
  emoji: '🦁',
  orderIndex: 0,
  score: 0,
  members: [],
  ...over,
});

const mkRecap = (over: Partial<Recap> = {}): Recap => ({
  date: '07-03',
  weekday: '周四',
  lessonNumber: 3,
  lessonTitle: 'Please send me a card',
  actualDurationMin: 120,
  attendancePresent: 0,
  attendanceTotal: 0,
  groups: [],
  ungrouped: [],
  stars: [],
  warned: [],
  studentTags: [],
  ...over,
});

describe('podiumStars', () => {
  const recap = mkRecap({
    groups: [
      grp('第1组', {
        emoji: '🦁',
        orderIndex: 0,
        members: [mem('小明', { score: 5 }), mem('思思', { score: 2 })],
      }),
      grp('第2组', {
        emoji: '🐯',
        orderIndex: 1,
        members: [mem('欣欣', { score: 4 }), mem('大壮', { score: 1 })],
      }),
    ],
  });

  it('picks top-3 present scorers and arranges them 讲台式 [2nd, 1st, 3rd]', () => {
    const stars = podiumStars(recap);
    expect(stars.map((s) => [s.name, s.rank])).toEqual([
      ['欣欣', 1],
      ['小明', 0],
      ['思思', 2],
    ]);
    expect(stars[1].groupName).toBe('第1组');
    expect(stars[1].groupEmoji).toBe('🦁');
  });

  it('excludes absentees and non-positive scores', () => {
    const r = mkRecap({
      groups: [
        grp('第1组', {
          members: [
            mem('小明', { score: 3, attendance: 'absent' }),
            mem('思思', { score: 0 }),
            mem('乐乐', { score: -1 }),
          ],
        }),
      ],
    });
    expect(podiumStars(r)).toEqual([]);
  });

  it('handles fewer than 3 stars (1st centered-last when only two)', () => {
    const r = mkRecap({
      groups: [grp('第1组', { members: [mem('小明', { score: 2 }), mem('思思', { score: 1 })] })],
    });
    expect(podiumStars(r).map((s) => s.rank)).toEqual([1, 0]);
  });

  it('includes ungrouped present members (no group meta)', () => {
    const r = mkRecap({ ungrouped: [mem('浩浩', { score: 3 })] });
    const stars = podiumStars(r);
    expect(stars).toHaveLength(1);
    expect(stars[0].groupName).toBeNull();
    expect(stars[0].groupEmoji).toBeNull();
  });
});

describe('groupCards', () => {
  it('ranks by score desc with orderIndex tiebreak, assigning medals and rank labels', () => {
    const r = mkRecap({
      groups: [
        grp('第1组', { orderIndex: 0, score: 4 }),
        grp('第2组', { orderIndex: 1, score: 6 }),
        grp('第3组', { orderIndex: 2, score: 4 }),
        grp('第4组', { orderIndex: 3, score: 1 }),
      ],
    });
    const cards = groupCards(r);
    expect(cards.map((c) => [c.name, c.medal, c.rankLabel])).toEqual([
      ['第2组', '🥇', '第1名'],
      ['第1组', '🥈', '第2名'],
      ['第3组', '🥉', '第3名'],
      ['第4组', '', '第4名'],
    ]);
  });

  it('keeps the palette keyed to orderIndex (not rank) and cycles past the palette count', () => {
    const r = mkRecap({
      groups: [grp('第1组', { orderIndex: 0, score: 0 }), grp('第2组', { orderIndex: 1, score: 9 })],
    });
    const cards = groupCards(r);
    expect(cards[0].name).toBe('第2组');
    expect(cards[0].palette).toEqual(paletteFor(1));
    expect(cards[1].palette).toEqual(paletteFor(0));
    expect(paletteFor(5)).toEqual(paletteFor(0));
  });

  it('sorts present member rows by score desc and moves absentees to the footer text', () => {
    const r = mkRecap({
      groups: [
        grp('第1组', {
          members: [
            mem('思思', { score: 1 }),
            mem('小明', { score: 5 }),
            mem('悦悦', { attendance: 'leave' }),
            mem('乐乐', { attendance: 'absent' }),
          ],
        }),
      ],
    });
    const [card] = groupCards(r);
    expect(card.members.map((m) => m.name)).toEqual(['小明', '思思']);
    expect(card.absentText).toBe('悦悦 请假未到 · 乐乐 缺席未到');
  });
});

describe('absentText / ungroupedNote', () => {
  it('returns null when everyone attended', () => {
    expect(absentText([mem('小明')])).toBeNull();
  });

  it('groups names by leave vs absent', () => {
    expect(absentText([mem('a', { attendance: 'leave' }), mem('b', { attendance: 'leave' })])).toBe('a、b 请假未到');
  });

  it('ungroupedNote covers absent and 未分组 present members', () => {
    expect(ungroupedNote(mkRecap())).toBeNull();
    expect(ungroupedNote(mkRecap({ ungrouped: [mem('浩浩', { attendance: 'absent' })] }))).toBe('浩浩 缺席未到');
    expect(ungroupedNote(mkRecap({ ungrouped: [mem('新新')] }))).toBe('新新 未分组');
  });
});

describe('statSections', () => {
  const r = mkRecap({
    groups: [
      grp('第1组', {
        emoji: '🦁',
        members: [
          mem('小明', { recitation: '已背完', homework: '完成' }),
          mem('思思', { recitation: '背完部分', homework: '需补' }),
          mem('乐乐', { recitation: '没背', homework: '没交', warns: 1 }),
          mem('走了', { attendance: 'absent', recitation: null, homework: null }),
        ],
      }),
    ],
    ungrouped: [mem('浩浩', { recitation: null, homework: null, warns: 2 })],
  });

  it('buckets 背书/作业/提醒 chips with tones, ignoring absentees', () => {
    const [recite, hw, warn] = statSections(r);
    expect(recite.chips.map((c) => [c.name, c.tag, c.tone])).toEqual([
      ['思思', '背完部分', 'amber'],
      ['乐乐', '没背', 'red'],
      ['浩浩', '未检查', 'gray'],
    ]);
    expect(hw.chips.map((c) => [c.name, c.tag, c.tone])).toEqual([
      ['思思', '需补', 'amber'],
      ['乐乐', '没交', 'red'],
      ['浩浩', '没交', 'red'],
    ]);
    // warn chips sorted by count desc
    expect(warn.chips.map((c) => [c.name, c.tag, c.tone])).toEqual([
      ['浩浩', '提醒 ×2', 'red'],
      ['乐乐', '提醒 ×1', 'red'],
    ]);
    expect(recite.chips[0].groupEmoji).toBe('🦁');
    expect(recite.chips[2].groupEmoji).toBeNull();
  });

  it('drops 背书/作业 sections when the corresponding check is disabled', () => {
    expect(statSections(r, { showRecitation: false }).map((s) => s.title)).toEqual(['作业未完成', '被老师提醒']);
    expect(statSections(r, { showHomework: false }).map((s) => s.title)).toEqual(['背书未完成', '被老师提醒']);
    expect(statSections(r, { showRecitation: false, showHomework: false }).map((s) => s.title)).toEqual(['被老师提醒']);
  });

  it('reports empty sections with a celebration text', () => {
    const clean = mkRecap({
      groups: [grp('第1组', { members: [mem('小明', { recitation: '已背完', homework: '完成' })] })],
    });
    const sections = statSections(clean);
    expect(sections.every((s) => s.chips.length === 0)).toBe(true);
    expect(sections.map((s) => s.emptyText)).toEqual([
      '🎉 全员背书过关！',
      '🎉 全员作业过关！',
      '🎉 无人被提醒，课堂纪律很棒！',
    ]);
  });
});

describe('status styles', () => {
  it('maps recitation status (null → 未检查)', () => {
    expect(recitationStyle('已背完').text).toBe('已背完');
    expect(recitationStyle(null).text).toBe('未检查');
    expect(recitationStyle('没背').color).not.toBe(recitationStyle('已背完').color);
  });

  it('maps homework status (null → 没交)', () => {
    expect(homeworkStyle('完成').text).toBe('完成');
    expect(homeworkStyle(null).text).toBe('没交');
    expect(homeworkStyle('需补').color).not.toBe(homeworkStyle('完成').color);
  });
});
