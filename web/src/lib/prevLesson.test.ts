import { describe, expect, it } from 'vitest';
import type { Recap, Session } from './api';
import { prevLessonGroups, prevLessonInfo, prevLessonStars } from './prevLesson';

function mkSession(over: Partial<Session>): Session {
  return {
    id: 'sess-1',
    date: '7月1日',
    year: '2026',
    weekday: '周二',
    lessonNumber: 7,
    lessonTitle: 'Too late',
    teacherId: 't-wangli',
    teacherName: '王莉',
    plannedDurationMin: 120,
    actualDurationMin: 115,
    durationLabel: '1小时55分',
    startedAt: '2026-07-01 18:00:00',
    endedAt: '2026-07-01 19:55:00',
    groupCount: 3,
    hasHomework: true,
    attendancePresent: 12,
    attendanceTotal: 13,
    ...over,
  };
}

describe('prevLessonInfo', () => {
  it('没有上课记录 → null', () => {
    expect(prevLessonInfo([])).toBeNull();
  });

  it('取首条（服务端按日期倒序）拼日期与课次标签', () => {
    const info = prevLessonInfo([
      mkSession({ id: 'sess-new' }),
      mkSession({ id: 'sess-old', date: '6月28日', weekday: '周日', lessonNumber: 6 }),
    ]);
    expect(info).toEqual({
      sessionId: 'sess-new',
      dateLabel: '7月1日 周二',
      lessonText: '第7课 · Too late',
      hasHomework: true,
    });
  });

  it('课次课题皆空 → 占位文案；hasHomework 透传', () => {
    const info = prevLessonInfo([mkSession({ lessonNumber: null, lessonTitle: null, hasHomework: false })]);
    expect(info?.lessonText).toBe('未填写课次');
    expect(info?.hasHomework).toBe(false);
  });
});

function mkRecap(over: Partial<Recap>): Recap {
  return {
    date: '7月1日',
    weekday: '周二',
    lessonNumber: 7,
    lessonTitle: 'Too late',
    actualDurationMin: 115,
    attendancePresent: 12,
    attendanceTotal: 13,
    groups: [],
    stars: [],
    warned: [],
    studentTags: [],
    ...over,
  };
}

describe('prevLessonGroups', () => {
  it('按分数降序排列，同分用 orderIndex 稳定次序', () => {
    const groups = prevLessonGroups(
      mkRecap({
        groups: [
          { name: '蓝队', emoji: '🐬', orderIndex: 1, score: 3 },
          { name: '红队', emoji: '🔥', orderIndex: 0, score: 5 },
          { name: '绿队', emoji: '🌿', orderIndex: 2, score: 3 },
        ],
      }),
    );
    expect(groups).toEqual([
      { name: '红队', emoji: '🔥', score: 5 },
      { name: '蓝队', emoji: '🐬', score: 3 },
      { name: '绿队', emoji: '🌿', score: 3 },
    ]);
  });

  it('无小组 → 空数组', () => {
    expect(prevLessonGroups(mkRecap({ groups: [] }))).toEqual([]);
  });
});

describe('prevLessonStars', () => {
  it('取净得分最高前三，降序', () => {
    const stars = prevLessonStars(
      mkRecap({
        stars: [
          { name: '小明', net: 2 },
          { name: '军军', net: 5 },
          { name: '浩浩', net: 3 },
          { name: '丽丽', net: 4 },
        ],
      }),
    );
    expect(stars).toEqual([
      { name: '军军', net: 5 },
      { name: '丽丽', net: 4 },
      { name: '浩浩', net: 3 },
    ]);
  });

  it('无亮眼学生 → 空数组', () => {
    expect(prevLessonStars(mkRecap({ stars: [] }))).toEqual([]);
  });
});
