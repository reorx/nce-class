import { describe, expect, it } from 'vitest';
import { gScore, sScore } from './session';
import type { SessionConfig } from './setup';
import {
  buildClassroomSession,
  buildCommitPayload,
  clearSession,
  loadSession,
  nowSql,
  reducer,
  saveSession,
  type ClassroomSession,
} from './classroomStore';

// A tiny in-memory Storage stand-in (vitest runs in node — no real localStorage).
function memStore(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

// c1-shaped config: 3 playing across 2 groups, one pre-class absent that KEEPS
// its default group (小刚→g1), and one ungrouped absent (浩浩, no default group).
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
    absent: [
      { id: 's3', name: '小刚', originalGroupId: 'g1' }, // absent but stays in g1's default
      { id: 's13', name: '浩浩', originalGroupId: null }, // ungrouped
    ],
  };
}

const META = { classId: 'c1', clientSessionId: 'cs-test', startedAt: '2026-07-02 19:00:00' };
const boot = () => buildClassroomSession(config(), META);

describe('buildClassroomSession', () => {
  it('registers everyone, marking pre-class staged students absent', () => {
    const s = boot();
    expect(s.students).toHaveLength(5);
    expect(s.students.filter((x) => x.attendance === 'present').map((x) => x.id)).toEqual(['s1', 's2', 's5']);
    expect(s.students.filter((x) => x.attendance === 'absent').map((x) => x.id)).toEqual(['s3', 's13']);
    expect(s.events).toEqual([]);
    expect(s.clientSessionId).toBe('cs-test');
    expect(s.startedAt).toBe('2026-07-02 19:00:00');
    expect(s.plannedDurationMin).toBe(120);
    expect(s.lessonNumber).toBe('4');
  });

  it('freezes a default grouping that keeps absent students in their original group (decision 6)', () => {
    const s = boot();
    const g1 = s.defaultGrouping.find((g) => g.clientId === 'g1')!;
    const g2 = s.defaultGrouping.find((g) => g.clientId === 'g2')!;
    expect(g1.memberIds.sort()).toEqual(['s1', 's2', 's3']); // 小刚 absent yet kept in g1
    expect(g2.memberIds).toEqual(['s5']);
    // 浩浩 (ungrouped absent) is in no default group
    expect(s.defaultGrouping.some((g) => g.memberIds.includes('s13'))).toBe(false);
    expect(s.defaultGrouping.map((g) => g.orderIndex)).toEqual([0, 1]);
  });
});

describe('classroom reducer', () => {
  const at = '2026-07-02 19:05:00';

  it('scores a student against their current group and derives the personal score', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at });
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at });
    expect(sScore(s.events, 's1')).toBe(2);
    expect(s.events[0]).toMatchObject({ tt: 'student', tid: 's1', g: 'g1', d: 1, createdAt: at });
  });

  it('scores a group at the group level without touching personal scores', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreGroup', gid: 'g1', d: 1, at });
    expect(gScore(s.events, 'g1')).toBe(1);
    expect(sScore(s.events, 's1')).toBe(0);
  });

  it('undo drops the last event only', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at });
    s = reducer(s, { type: 'scoreGroup', gid: 'g1', d: 1, at });
    s = reducer(s, { type: 'undo' });
    expect(s.events).toHaveLength(1);
    expect(sScore(s.events, 's1')).toBe(1);
  });

  it('sets recitation / homework labels explicitly (re-selecting keeps, null clears)', () => {
    let s = boot();
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完' });
    expect(s.students.find((x) => x.id === 's1')!.r).toBe('已背完');
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完' });
    expect(s.students.find((x) => x.id === 's1')!.r).toBe('已背完');
    s = reducer(s, { type: 'setRecite', sid: 's1', v: null });
    expect(s.students.find((x) => x.id === 's1')!.r).toBe(null);
    s = reducer(s, { type: 'setHomework', sid: 's2', v: '完成' });
    expect(s.students.find((x) => x.id === 's2')!.h).toBe('完成');
    s = reducer(s, { type: 'setHomework', sid: 's2', v: null });
    expect(s.students.find((x) => x.id === 's2')!.h).toBe(null);
  });

  it('toggles attendance', () => {
    let s = boot();
    s = reducer(s, { type: 'toggleAttendance', sid: 's1' });
    expect(s.students.find((x) => x.id === 's1')!.attendance).toBe('absent');
    s = reducer(s, { type: 'toggleAttendance', sid: 's1' });
    expect(s.students.find((x) => x.id === 's1')!.attendance).toBe('present');
  });

  it('sets a group emoji on the live groups AND the default-grouping writeback', () => {
    let s = boot();
    s = reducer(s, { type: 'setGroupEmoji', gid: 'g1', emoji: '🐸' });
    expect(s.groups.find((g) => g.id === 'g1')!.emoji).toBe('🐸');
    expect(s.groups.find((g) => g.id === 'g2')!.emoji).toBe('🐯');
    expect(s.defaultGrouping.find((g) => g.clientId === 'g1')!.emoji).toBe('🐸');
    // and it ships in the one-shot commit payload
    const p = buildCommitPayload(s, '2026-07-02 21:00:00');
    expect(p.sessionGroups.find((g) => g.clientId === 'g1')!.emoji).toBe('🐸');
    expect(p.defaultGrouping.groups.find((g) => g.clientId === 'g1')!.emoji).toBe('🐸');
  });

  it('renames a group on the live groups AND the default-grouping writeback', () => {
    let s = boot();
    s = reducer(s, { type: 'renameGroup', gid: 'g1', name: '雄狮队' });
    expect(s.groups.find((g) => g.id === 'g1')!.name).toBe('雄狮队');
    expect(s.groups.find((g) => g.id === 'g2')!.name).toBe('第2组');
    expect(s.defaultGrouping.find((g) => g.clientId === 'g1')!.name).toBe('雄狮队');
  });

  it('removes a group: members become ungrouped, snapshot & writeback drop it, history stays', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreGroup', gid: 'g1', d: 1, at });
    s = reducer(s, { type: 'removeGroup', gid: 'g1' });
    expect(s.groups.map((g) => g.id)).toEqual(['g2']);
    expect(s.defaultGrouping.map((g) => g.clientId)).toEqual(['g2']);
    // every member of g1 (present s1/s2 + pre-class absent s3) is now ungrouped
    expect(s.students.filter((x) => ['s1', 's2', 's3'].includes(x.id)).every((x) => x.g === '')).toBe(true);
    expect(s.events).toHaveLength(1); // 调组/删组 never rewrites the ledger
    const p = buildCommitPayload(s, '2026-07-02 21:00:00');
    expect(p.sessionGroups.map((g) => g.clientId)).toEqual(['g2']);
    expect(p.defaultGrouping.groups.map((g) => g.clientId)).toEqual(['g2']);
    expect(p.memberships.find((m) => m.studentId === 's1')!.clientGroupId).toBe(null);
  });

  it('updates lesson info mid-class (课次/课题/时长) and it flows into the commit payload', () => {
    let s = boot();
    s = reducer(s, { type: 'setLessonInfo', lessonNumber: '5', lessonTitle: 'No wrong numbers', durationMin: 90 });
    expect(s.lessonNumber).toBe('5');
    expect(s.lessonTitle).toBe('No wrong numbers');
    expect(s.plannedDurationMin).toBe(90);
    const p = buildCommitPayload(s, '2026-07-02 21:00:00');
    expect(p.lessonNumber).toBe(5);
    expect(p.lessonTitle).toBe('No wrong numbers');
    expect(p.plannedDurationMin).toBe(90);
  });

  it('clearing lesson fields mid-class reverts them to unset (null in the payload)', () => {
    let s = boot();
    s = reducer(s, { type: 'setLessonInfo', lessonNumber: '', lessonTitle: '', durationMin: 120 });
    expect(s.lessonNumber).toBeUndefined();
    expect(s.lessonTitle).toBeUndefined();
    const p = buildCommitPayload(s, '2026-07-02 21:00:00');
    expect(p.lessonNumber).toBeNull();
    expect(p.lessonTitle).toBeNull();
  });

  it('re-grouping only affects future scoring, not historical group scores', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at }); // earns for g1
    s = reducer(s, { type: 'moveStudent', sid: 's1', gid: 'g2' });
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at }); // now earns for g2
    expect(gScore(s.events, 'g1')).toBe(1); // history preserved
    expect(gScore(s.events, 'g2')).toBe(1);
    expect(sScore(s.events, 's1')).toBe(2);
  });
});

describe('persistence (LocalStorage round-trip)', () => {
  it('saves, reloads, and clears a session by class id', () => {
    const store = memStore();
    const s = boot();
    saveSession(s, store);
    expect(loadSession('c1', store)).toEqual(s);
    clearSession('c1', store);
    expect(loadSession('c1', store)).toBeNull();
  });

  it('returns null for a missing or corrupt entry', () => {
    const store = memStore();
    expect(loadSession('cX', store)).toBeNull();
    store.setItem('nce.classroom.cX', '{not json');
    expect(loadSession('cX', store)).toBeNull();
  });
});

describe('buildCommitPayload', () => {
  it('maps a finished session to the commit contract', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at: '2026-07-02 19:05:00' });
    s = reducer(s, { type: 'scoreGroup', gid: 'g2', d: 1, at: '2026-07-02 19:06:00' });
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完' });
    s = reducer(s, { type: 'setHomework', sid: 's2', v: '没交' });
    const p = buildCommitPayload(s, '2026-07-02 20:58:00');

    expect(p.clientSessionId).toBe('cs-test');
    expect(p.lessonNumber).toBe(4);
    expect(p.lessonTitle).toBe('A private conversation');
    expect(p.plannedDurationMin).toBe(120);
    expect(p.startedAt).toBe('2026-07-02 19:00:00');
    expect(p.endedAt).toBe('2026-07-02 20:58:00');

    // time strings stay in the naive 'YYYY-MM-DD HH:mm:ss' shape the server parses
    expect(p.startedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(p.endedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    // §7.2 writeback grouping keeps the absent 小刚 in g1
    expect(p.defaultGrouping.groups.find((g) => g.clientId === 'g1')!.memberIds.sort()).toEqual(['s1', 's2', 's3']);

    // every registered student is a membership; absent ⇒ clientGroupId null (decision 8)
    expect(p.memberships).toHaveLength(5);
    expect(p.memberships.find((m) => m.studentId === 's3')).toEqual({
      studentId: 's3',
      clientGroupId: null,
      attendance: 'absent',
    });
    expect(p.memberships.find((m) => m.studentId === 's1')).toEqual({
      studentId: 's1',
      clientGroupId: 'g1',
      attendance: 'present',
    });

    // events carry the group they fired in
    expect(p.events).toHaveLength(2);
    expect(p.events[0]).toEqual({
      targetType: 'student',
      targetId: 's1',
      clientGroupId: 'g1',
      delta: 1,
      createdAt: '2026-07-02 19:05:00',
    });
    expect(p.events[1]).toMatchObject({ targetType: 'group', targetId: 'g2', clientGroupId: 'g2', delta: 1 });

    // only checked/marked students appear in checks
    expect(p.checks).toContainEqual({ studentId: 's1', type: 'recitation', status: '已背完' });
    expect(p.checks).toContainEqual({ studentId: 's2', type: 'homework', status: '没交' });
    expect(p.checks).toHaveLength(2);
  });

  it('emits a null lessonNumber when the lesson field was left blank', () => {
    const cfg = { ...config(), lessonNumber: '' };
    const s = buildClassroomSession(cfg, META);
    expect(buildCommitPayload(s, '2026-07-02 20:00:00').lessonNumber).toBeNull();
  });
});

describe('主讲老师 (lead teacher)', () => {
  const withTeacher = () => buildClassroomSession({ ...config(), teacherId: 't-wangli', teacherName: '王莉' }, META);

  it('carries the setup-picked teacher into the session and the commit payload', () => {
    const s = withTeacher();
    expect(s.teacherId).toBe('t-wangli');
    expect(s.teacherName).toBe('王莉');
    expect(buildCommitPayload(s, '2026-07-02 20:00:00').teacherId).toBe('t-wangli');
  });

  it('emits a null teacherId when unset (server falls back to the committing teacher)', () => {
    const s = boot();
    expect(s.teacherId).toBeUndefined();
    expect(buildCommitPayload(s, '2026-07-02 20:00:00').teacherId).toBeNull();
  });

  it('setLessonInfo can change the teacher mid-class, and keeps it when omitted', () => {
    let s = withTeacher();
    s = reducer(s, {
      type: 'setLessonInfo',
      lessonNumber: '5',
      lessonTitle: '',
      durationMin: 90,
      teacherId: 't-lifang',
      teacherName: '李芳',
    });
    expect(s.teacherId).toBe('t-lifang');
    expect(s.teacherName).toBe('李芳');
    // an old-shape action (no teacher fields) must not wipe the choice
    s = reducer(s, { type: 'setLessonInfo', lessonNumber: '6', lessonTitle: '', durationMin: 90 });
    expect(s.teacherId).toBe('t-lifang');
    expect(s.teacherName).toBe('李芳');
  });
});

describe('nowSql', () => {
  it('formats a date as naive YYYY-MM-DD HH:mm:ss', () => {
    expect(nowSql(new Date(2026, 6, 2, 9, 5, 3))).toBe('2026-07-02 09:05:03');
  });
});

// Keep an unused ClassroomSession reference to pin the exported type name.
export type _Pin = ClassroomSession;
