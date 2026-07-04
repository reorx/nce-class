import { describe, expect, it } from 'vitest';
import type { Session } from './api';
import { prevLessonInfo } from './prevLesson';

function mkSession(over: Partial<Session>): Session {
  return {
    id: 'sess-1',
    date: '7月1日',
    year: '2026',
    weekday: '周二',
    lessonNumber: 7,
    lessonTitle: 'Too late',
    teacherName: '王莉',
    plannedDurationMin: 120,
    actualDurationMin: 115,
    durationLabel: '1小时55分',
    startedAt: '2026-07-01 18:00:00',
    endedAt: '2026-07-01 19:55:00',
    groupCount: 3,
    hasHomework: true,
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
