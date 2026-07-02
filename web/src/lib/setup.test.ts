import { describe, expect, it } from 'vitest';
import type { ClassDetail } from './api';
import {
  addGroup,
  buildSessionConfig,
  buildSetup,
  fmtDurationCN,
  membersOf,
  moveStudent,
  stagingMembers,
  sums,
} from './setup';

// 课前配置 grouping model (§7.2). Mirrors the seeded 三年级A班: 12 grouped
// students across 3 default groups + one ungrouped duplicate (浩浩) that lands
// in the 未分组/今日缺席 staging zone.
function fixture(): Pick<ClassDetail, 'groups' | 'students'> {
  const g = (id: string, name: string, emoji: string, orderIndex: number) => ({
    id,
    name,
    emoji,
    orderIndex,
    memberIds: [] as string[],
  });
  const s = (id: string, name: string, groupId: string | null) => ({
    id,
    name,
    source: 'parent' as const,
    hasPhoto: true,
    score: 0,
    groupId,
  });
  return {
    groups: [g('c1-g1', '第1组', '🦁', 0), g('c1-g2', '第2组', '🐯', 1), g('c1-g3', '第3组', '🐻', 2)],
    students: [
      s('s1', '小明', 'c1-g1'),
      s('s2', '小红', 'c1-g1'),
      s('s3', '小刚', 'c1-g1'),
      s('s4', '乐乐', 'c1-g1'),
      s('s5', '丽丽', 'c1-g2'),
      s('s6', '大壮', 'c1-g2'),
      s('s7', '欣欣', 'c1-g2'),
      s('s8', '明明', 'c1-g2'),
      s('s9', '军军', 'c1-g3'),
      s('s10', '悦悦', 'c1-g3'),
      s('s11', '婷婷', 'c1-g3'),
      s('s12', '浩浩', 'c1-g3'),
      s('s13', '浩浩', null), // ungrouped duplicate
    ],
  };
}

describe('课前配置 grouping model', () => {
  it('seeds groups from the default grouping and drops ungrouped students into staging', () => {
    const st = buildSetup(fixture());
    expect(st.groups.map((g) => g.name)).toEqual(['第1组', '第2组', '第3组']);
    expect(membersOf(st, 'c1-g1').map((s) => s.name)).toEqual(['小明', '小红', '小刚', '乐乐']);
    expect(stagingMembers(st).map((s) => s.name)).toEqual(['浩浩']); // the ungrouped one
    expect(sums(st)).toEqual({ groups: 3, playing: 12, absent: 1 });
  });

  it('carries the group order index as the colour index', () => {
    const st = buildSetup(fixture());
    expect(st.groups.map((g) => g.ci)).toEqual([0, 1, 2]);
  });

  it('moves a student into the staging zone (excluded from scoring)', () => {
    const st = moveStudent(buildSetup(fixture()), 's1', 'absent');
    expect(membersOf(st, 'c1-g1').map((s) => s.name)).toEqual(['小红', '小刚', '乐乐']);
    expect(stagingMembers(st).map((s) => s.name)).toEqual(['小明', '浩浩']);
    expect(sums(st)).toEqual({ groups: 3, playing: 11, absent: 2 });
  });

  it('moves a staged student into a group so it joins scoring', () => {
    const st = moveStudent(buildSetup(fixture()), 's13', 'c1-g1');
    expect(membersOf(st, 'c1-g1').map((s) => s.name)).toEqual(['小明', '小红', '小刚', '乐乐', '浩浩']);
    expect(sums(st)).toEqual({ groups: 3, playing: 13, absent: 0 });
  });

  it('re-drops a student into a different group (drag across columns)', () => {
    const st = moveStudent(buildSetup(fixture()), 's1', 'c1-g2');
    expect(membersOf(st, 'c1-g1').map((s) => s.name)).toEqual(['小红', '小刚', '乐乐']);
    expect(membersOf(st, 'c1-g2').map((s) => s.name)).toEqual(['小明', '丽丽', '大壮', '欣欣', '明明']);
  });

  it('adds a new empty group with the next emoji + colour', () => {
    const st = addGroup(buildSetup(fixture()));
    expect(st.groups).toHaveLength(4);
    const last = st.groups[3];
    expect(last.name).toBe('第4组');
    expect(last.emoji).toBe('🐬');
    expect(last.ci).toBe(3);
    expect(membersOf(st, last.id)).toEqual([]);
    expect(sums(st).groups).toBe(4);
  });

  it('builds a classroom handoff config of only the playing students', () => {
    const st = buildSetup(fixture());
    const cfg = buildSessionConfig(st, { lessonNumber: '4', lessonTitle: 'A private conversation', durationMin: 120 });
    expect(cfg.students).toHaveLength(12); // 浩浩(未分组) excluded
    expect(cfg.students.every((s) => s.g)).toBe(true);
    expect(cfg.groups.map((g) => g.id)).toEqual(['c1-g1', 'c1-g2', 'c1-g3']);
    expect(cfg.durationMin).toBe(120);
    expect(cfg.lessonTitle).toBe('A private conversation');
  });
});

describe('fmtDurationCN', () => {
  it('formats hours + minutes', () => {
    expect(fmtDurationCN(112)).toBe('1 小时 52 分');
    expect(fmtDurationCN(131)).toBe('2 小时 11 分');
  });
  it('drops the minutes on whole hours', () => {
    expect(fmtDurationCN(120)).toBe('2 小时');
    expect(fmtDurationCN(60)).toBe('1 小时');
  });
  it('shows minutes only under an hour', () => {
    expect(fmtDurationCN(45)).toBe('45 分钟');
  });
});
