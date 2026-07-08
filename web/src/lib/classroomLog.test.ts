import { describe, expect, it } from 'vitest';
import { buildLogLines } from './classroomLog';
import { buildClassroomSession, reducer, type ClassroomSession } from './classroomStore';
import type { SessionConfig } from './setup';

function config(): SessionConfig {
  return {
    lessonNumber: '4',
    lessonTitle: 'A private conversation',
    durationMin: 120,
    className: '三年级A班',
    groups: [
      { id: 'g1', name: '第1组', emoji: '🦁', ci: 0 },
      { id: 'g2', name: '第2组', emoji: '🐯', ci: 1 },
    ],
    students: [
      { id: 's1', name: '小明', g: 'g1' },
      { id: 's2', name: '小红', g: 'g1' },
      { id: 's5', name: '丽丽', g: 'g2' },
    ],
    absent: [],
  };
}

const boot = () =>
  buildClassroomSession(config(), { classId: 'c1', clientSessionId: 'cs-test', startedAt: '2026-07-02 19:00:00' });

const at = (m: number) => `2026-07-02 19:${String(m).padStart(2, '0')}:00`;

describe('buildLogLines', () => {
  it('merges score events and status changes into one timeline, newest first (shared nid order)', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at: at(5) }); // id 1
    s = reducer(s, { type: 'setRecite', sid: 's2', v: '背完部分', at: at(6) }); // id 2
    s = reducer(s, { type: 'scoreGroup', gid: 'g2', d: 1, at: at(7) }); // id 3
    s = reducer(s, { type: 'toggleAttendance', sid: 's5', at: at(8) }); // id 4
    const lines = buildLogLines(s);
    expect(lines.map((l) => l.id)).toEqual([4, 3, 2, 1]);
    expect(lines.map((l) => l.at)).toEqual([at(8), at(7), at(6), at(5)]);
  });

  it('renders a student score line with its group sync detail, undoable via eventId', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at: at(5) });
    const [l] = buildLogLines(s);
    expect(l).toMatchObject({ who: '小明', action: '+1', detail: '第1组 同步 +1', eventId: 1, tone: 'plus' });
  });

  it('renders a minus student score line with minus tone', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: -1, at: at(5) });
    const [l] = buildLogLines(s);
    expect(l).toMatchObject({ who: '小明', action: '−1', detail: '第1组 同步 −1', tone: 'minus' });
  });

  it('renders a group score line (no personal detail), undoable via eventId', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreGroup', gid: 'g2', d: 1, at: at(5) });
    const [l] = buildLogLines(s);
    expect(l).toMatchObject({ who: '第2组', action: '+1', eventId: 1, tone: 'plus' });
    expect(l.detail).toBeUndefined();
  });

  it('renders status lines as record-only (no eventId): 背书 / 作业 / 出勤两个方向', () => {
    let s = boot();
    // 「背完部分」不触发自动加分 → 本用例只看 record-only 状态行
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '背完部分', at: at(5) });
    s = reducer(s, { type: 'setHomework', sid: 's2', v: '完成', at: at(6) });
    s = reducer(s, { type: 'setHomework', sid: 's2', v: '没交', at: at(7) });
    s = reducer(s, { type: 'toggleAttendance', sid: 's5', at: at(8) }); // → absent
    s = reducer(s, { type: 'toggleAttendance', sid: 's5', at: at(9) }); // → present
    const lines = buildLogLines(s);
    expect(lines.every((l) => l.eventId === undefined && l.tone === 'neutral')).toBe(true);
    expect(lines.map((l) => [l.who, l.action])).toEqual([
      ['丽丽', '恢复到勤'],
      ['丽丽', '标记未到'],
      ['小红', '作业 → 没交'],
      ['小红', '作业 → 完成'],
      ['小明', '背书 → 背完部分'],
    ]);
  });

  it('背书自动加分显示为可撤销的加分行，detail 标注来源', () => {
    let s = boot();
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at: at(5) }); // log id 1 + 事件 id 2
    const [point, status] = buildLogLines(s);
    expect(status).toMatchObject({ who: '小明', action: '背书 → 已背完', tone: 'neutral' });
    expect(point).toMatchObject({ who: '小明', action: '+1', eventId: 2, tone: 'plus' });
    expect(point.detail).toBe('背书自动加分 · 第1组 同步 +1');
  });

  it('falls back gracefully when the event group was deleted, and omits detail for ungrouped students', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at: at(5) }); // fired in g1
    s = reducer(s, { type: 'removeGroup', gid: 'g1' }); // g1 gone, s1 ungrouped
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at: at(6) }); // fired ungrouped
    const [ungrouped, deleted] = buildLogLines(s);
    expect(deleted.detail).toBe('已删除小组 同步 +1');
    expect(ungrouped.detail).toBeUndefined();
  });

  it('tolerates an old session shape without log', () => {
    const legacy = { ...boot() };
    delete (legacy as Partial<ClassroomSession>).log;
    expect(buildLogLines(legacy)).toEqual([]);
  });
});
