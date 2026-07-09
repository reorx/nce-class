import { describe, expect, it } from 'vitest';
import { gScore, sScore } from './session';
import type { SessionConfig } from './setup';
import type { SessionDetail } from './api';
import {
  applyStartTime,
  buildClassroomSession,
  buildCommitPayload,
  buildEditSession,
  clearCommitBackup,
  clearSession,
  endSql,
  listCommitBackups,
  loadSession,
  nowSql,
  reducer,
  saveCommitBackup,
  saveSession,
  sqlFromParts,
  startTimeOf,
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

  it('boots everyone at 背书未检查 (null) and 作业默认「没交」(未批改桶已移除)', () => {
    const s = boot();
    expect(s.students.every((x) => x.r === null)).toBe(true);
    expect(s.students.every((x) => x.h === '没交')).toBe(true);
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

  it('sets recitation / homework labels explicitly (re-selecting keeps, null clears recite)', () => {
    let s = boot();
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at });
    expect(s.students.find((x) => x.id === 's1')!.r).toBe('已背完');
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at });
    expect(s.students.find((x) => x.id === 's1')!.r).toBe('已背完');
    s = reducer(s, { type: 'setRecite', sid: 's1', v: null, at });
    expect(s.students.find((x) => x.id === 's1')!.r).toBe(null);
    s = reducer(s, { type: 'setHomework', sid: 's2', v: '完成', at });
    expect(s.students.find((x) => x.id === 's2')!.h).toBe('完成');
    s = reducer(s, { type: 'setHomework', sid: 's2', v: '需补', at });
    expect(s.students.find((x) => x.id === 's2')!.h).toBe('需补');
    s = reducer(s, { type: 'setHomework', sid: 's2', v: '没交', at });
    expect(s.students.find((x) => x.id === 's2')!.h).toBe('没交');
  });

  it('toggles attendance', () => {
    let s = boot();
    s = reducer(s, { type: 'toggleAttendance', sid: 's1', at });
    expect(s.students.find((x) => x.id === 's1')!.attendance).toBe('absent');
    s = reducer(s, { type: 'toggleAttendance', sid: 's1', at });
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

  it('setLessonInfo can shift startedAt (开始时间), and keeps it when omitted', () => {
    let s = boot();
    s = reducer(s, {
      type: 'setLessonInfo',
      lessonNumber: '4',
      lessonTitle: 'A private conversation',
      durationMin: 120,
      startedAt: '2026-07-02 19:30:00',
    });
    expect(s.startedAt).toBe('2026-07-02 19:30:00');
    // an old-shape action (no startedAt) must not wipe it — pre-existing call
    // sites and sessions persisted by older builds stay intact
    s = reducer(s, { type: 'setLessonInfo', lessonNumber: '5', lessonTitle: '', durationMin: 90 });
    expect(s.startedAt).toBe('2026-07-02 19:30:00');
    const p = buildCommitPayload(s, '2026-07-02 21:00:00');
    expect(p.startedAt).toBe('2026-07-02 19:30:00');
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

describe('奖章 tags (addTag / removeTag)', () => {
  const at = '2026-07-02 19:05:00';
  const tagsOf = (s: ClassroomSession, sid: string) => s.students.find((x) => x.id === sid)!.tags;

  it('boots every student with an empty tags array', () => {
    const s = boot();
    expect(s.students.every((x) => Array.isArray(x.tags) && x.tags.length === 0)).toBe(true);
  });

  it('adds normalised tags; re-adding a variant of the same tag is a no-op', () => {
    let s = boot();
    s = reducer(s, { type: 'addTag', sid: 's1', tag: '  听写全对 ' });
    s = reducer(s, { type: 'addTag', sid: 's1', tag: '默写全对' });
    expect(tagsOf(s, 's1')).toEqual(['听写全对', '默写全对']);
    const before = s;
    s = reducer(s, { type: 'addTag', sid: 's1', tag: '听写全对' });
    expect(s).toBe(before);
    s = reducer(s, { type: 'addTag', sid: 's1', tag: '   ' }); // blank → no-op
    expect(s).toBe(before);
  });

  it('removes a tag (case/whitespace-insensitively), leaving others intact', () => {
    let s = boot();
    s = reducer(s, { type: 'addTag', sid: 's1', tag: 'Star' });
    s = reducer(s, { type: 'addTag', sid: 's1', tag: '默写全对' });
    s = reducer(s, { type: 'removeTag', sid: 's1', tag: ' star ' });
    expect(tagsOf(s, 's1')).toEqual(['默写全对']);
  });

  it('never touches the score ledger (不联动加分, undo 不影响奖章)', () => {
    let s = boot();
    s = reducer(s, { type: 'addTag', sid: 's1', tag: '听写全对' });
    expect(s.events).toHaveLength(0);
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at });
    s = reducer(s, { type: 'undo' });
    expect(tagsOf(s, 's1')).toEqual(['听写全对']);
  });

  it('an old persisted session without tags still loads and accepts tag edits (persisted-shape compat)', () => {
    const store = memStore();
    const legacy = boot();
    const stripped = {
      ...legacy,
      students: legacy.students.map((x) => {
        const { tags: _tags, ...rest } = x;
        return rest;
      }),
    };
    store.setItem('nce.classroom.c1', JSON.stringify(stripped));
    let s = loadSession('c1', store)!;
    expect(s).not.toBeNull();
    s = reducer(s, { type: 'removeTag', sid: 's1', tag: '不存在' }); // must not throw
    s = reducer(s, { type: 'addTag', sid: 's1', tag: '听写全对' });
    expect(tagsOf(s, 's1')).toEqual(['听写全对']);
    // and the commit payload from that old-shape session still builds
    const p = buildCommitPayload(s, '2026-07-02 21:00:00');
    expect(p.tags).toEqual([{ studentId: 's1', tag: '听写全对' }]);
  });

  it('flattens per-student tags into the commit payload', () => {
    let s = boot();
    s = reducer(s, { type: 'addTag', sid: 's1', tag: '听写全对' });
    s = reducer(s, { type: 'addTag', sid: 's1', tag: '默写全对' });
    s = reducer(s, { type: 'addTag', sid: 's2', tag: '听写全对' });
    const p = buildCommitPayload(s, '2026-07-02 21:00:00');
    expect(p.tags).toEqual([
      { studentId: 's1', tag: '听写全对' },
      { studentId: 's1', tag: '默写全对' },
      { studentId: 's2', tag: '听写全对' },
    ]);
  });
});

describe('课堂日志 (status log + 任意单条撤销)', () => {
  const at = '2026-07-02 19:05:00';
  const at2 = '2026-07-02 19:06:00';

  it('logs recite / homework / attendance changes, sharing the nid sequence with score events', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at }); // takes id 1
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at: at2 }); // log id 2 + 自动加分事件 id 3
    s = reducer(s, { type: 'toggleAttendance', sid: 's2', at: at2 });
    expect(s.log).toEqual([
      { id: 2, at: at2, kind: 'recite', sid: 's1', to: '已背完' },
      { id: 4, at: at2, kind: 'attendance', sid: 's2', to: 'absent' },
    ]);
    expect(s.events.map((e) => e.id)).toEqual([1, 3]);
    expect(s.nid).toBe(5); // 一个计数器给两个数组发号 → 合并时间线有稳定全序
  });

  it('re-selecting the same status is a pure no-op (no state change, no log entry)', () => {
    let s = boot();
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at });
    const before = s;
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at: at2 });
    expect(s).toBe(before);
    expect(s.log).toHaveLength(1);
  });

  it('logs clearing recite back to 未检查 as to=null; 作业回到默认「没交」也记录', () => {
    let s = boot();
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at });
    s = reducer(s, { type: 'setRecite', sid: 's1', v: null, at: at2 });
    s = reducer(s, { type: 'setHomework', sid: 's2', v: '完成', at });
    s = reducer(s, { type: 'setHomework', sid: 's2', v: '没交', at: at2 });
    expect(s.log!.map((e) => e.to)).toEqual(['已背完', null, '完成', '没交']);
  });

  it('undoEvent removes exactly that event — personal & group score回退 atomically, others untouched', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at }); // id 1 → s1 & g1
    s = reducer(s, { type: 'scoreGroup', gid: 'g1', d: 1, at }); // id 2
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: -1, at }); // id 3
    s = reducer(s, { type: 'undoEvent', eventId: 1 });
    expect(s.events.map((e) => e.id)).toEqual([2, 3]);
    expect(sScore(s.events, 's1')).toBe(-1); // 个人分回退了 id1 的 +1
    expect(gScore(s.events, 'g1')).toBe(0); // 组分同一事件同时回退（原子性）
  });

  it('undoEvent with an unknown id is a no-op', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at });
    const before = s;
    s = reducer(s, { type: 'undoEvent', eventId: 99 });
    expect(s).toBe(before);
  });

  it('an old persisted session without log still loads, and logging starts fresh (persisted-shape compat)', () => {
    const store = memStore();
    const legacy = { ...boot() } as Record<string, unknown>;
    delete legacy.log;
    store.setItem('nce.classroom.c1', JSON.stringify(legacy));
    let s = loadSession('c1', store)!;
    expect(s).not.toBeNull();
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '没背', at });
    expect(s.log).toHaveLength(1);
  });

  it('the status log never enters the commit payload (仅本地)', () => {
    let s = boot();
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at });
    const p = buildCommitPayload(s, '2026-07-02 21:00:00');
    expect('log' in p).toBe(false);
  });
});

describe('背书自动加分（「已背完」在一节课内绑定唯一 1 分）', () => {
  const at = '2026-07-02 19:05:00';
  const at2 = '2026-07-02 19:06:00';
  const reciteEvents = (s: ClassroomSession, sid: string) =>
    s.events.filter((e) => e.src === 'recite' && e.tid === sid);

  it('标记「已背完」自动 +1：个人分与组分同步，事件带 src 标记', () => {
    let s = boot();
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at });
    expect(sScore(s.events, 's1')).toBe(1);
    expect(gScore(s.events, 'g1')).toBe(1);
    expect(reciteEvents(s, 's1')).toHaveLength(1);
    expect(reciteEvents(s, 's1')[0]).toMatchObject({ tt: 'student', tid: 's1', g: 'g1', d: 1, createdAt: at });
  });

  it('「背完部分」「没背」不加分', () => {
    let s = boot();
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '背完部分', at });
    s = reducer(s, { type: 'setRecite', sid: 's2', v: '没背', at });
    expect(s.events).toHaveLength(0);
  });

  it('离开「已背完」收回自动分，反复切换净效果恒为当前状态，绝不累积', () => {
    let s = boot();
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at });
    s = reducer(s, { type: 'setRecite', sid: 's1', v: null, at: at2 }); // 清回未检查 → 收回
    expect(sScore(s.events, 's1')).toBe(0);
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at: at2 }); // 再标 → 重新发
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '背完部分', at: at2 }); // 降级 → 收回
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at: at2 });
    expect(sScore(s.events, 's1')).toBe(1); // 多轮往返后仍只有 1 分
    expect(reciteEvents(s, 's1')).toHaveLength(1);
    expect(gScore(s.events, 'g1')).toBe(1);
  });

  it('收回只删背书来源的事件，手动加减分不受影响', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at });
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at });
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at });
    expect(sScore(s.events, 's1')).toBe(3);
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '没背', at: at2 });
    expect(sScore(s.events, 's1')).toBe(2); // 只收回自动分那 1 分
    expect(reciteEvents(s, 's1')).toHaveLength(0);
  });

  it('老师手动撤销自动分（undoEvent）后，状态保持「已背完」；重新往返可再次发分', () => {
    let s = boot();
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at });
    const eid = reciteEvents(s, 's1')[0].id;
    s = reducer(s, { type: 'undoEvent', eventId: eid });
    expect(s.students.find((x) => x.id === 's1')!.r).toBe('已背完');
    expect(sScore(s.events, 's1')).toBe(0);
    s = reducer(s, { type: 'setRecite', sid: 's1', v: null, at: at2 }); // 无自动分可收 → 只改状态
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at: at2 });
    expect(sScore(s.events, 's1')).toBe(1);
  });

  it('自动分作为普通事件进 commit payload，src 标记不外泄（向后兼容）', () => {
    let s = boot();
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at });
    const p = buildCommitPayload(s, '2026-07-02 21:00:00');
    expect(p.events).toHaveLength(1);
    expect(p.events[0]).toEqual({
      targetType: 'student',
      targetId: 's1',
      clientGroupId: 'g1',
      delta: 1,
      createdAt: at,
    });
    expect('src' in p.events[0]).toBe(false);
  });

  it('课中调组后再标背书，自动分记在当前组头上', () => {
    let s = boot();
    s = reducer(s, { type: 'moveStudent', sid: 's1', gid: 'g2' });
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at });
    expect(gScore(s.events, 'g2')).toBe(1);
    expect(gScore(s.events, 'g1')).toBe(0);
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

  it('normalizes 旧存档的 h:null（未批改）为默认「没交」on load', () => {
    const store = memStore();
    const legacy = JSON.parse(JSON.stringify(boot()));
    for (const st of legacy.students) st.h = null; // 未批改时代的存档 shape
    store.setItem('nce.classroom.c1', JSON.stringify(legacy));
    const loaded = loadSession('c1', store)!;
    expect(loaded.students.length).toBeGreaterThan(0);
    expect(loaded.students.every((x) => x.h === '没交')).toBe(true);
  });
});

describe('commit backup (失败兜底; keyed by clientSessionId so新课覆盖不掉)', () => {
  const backupOf = (s: ClassroomSession, endedAt: string, savedAt: string, store: Storage) =>
    saveCommitBackup({ session: s, payload: buildCommitPayload(s, endedAt), savedAt }, store);

  it('saves a retriable backup entry and clears it by clientSessionId', () => {
    const store = memStore();
    const s = boot();
    backupOf(s, '2026-07-02 20:58:00', '2026-07-02 20:58:01', store);

    const list = listCommitBackups(store);
    expect(list).toHaveLength(1);
    expect(list[0].savedAt).toBe('2026-07-02 20:58:01');
    expect(list[0].payload.clientSessionId).toBe('cs-test');
    expect(list[0].payload.endedAt).toBe('2026-07-02 20:58:00'); // payload frozen as-POSTed → 可原样重试
    expect(list[0].session.classId).toBe('c1'); // full session kept → 可手工恢复回 nce.classroom.<classId>

    clearCommitBackup('cs-test', store);
    expect(listCommitBackups(store)).toHaveLength(0);
  });

  it('survives the per-class entry being overwritten by a new session for the same class', () => {
    const store = memStore();
    const failed = boot(); // cs-test 的课提交失败
    saveSession(failed, store);
    backupOf(failed, '2026-07-02 20:58:00', '2026-07-02 20:58:01', store);

    // 老师随后对同一班级又开了一节新课 → 覆盖掉 nce.classroom.c1
    const next = buildClassroomSession(config(), { ...META, clientSessionId: 'cs-next' });
    saveSession(next, store);
    expect(loadSession('c1', store)!.clientSessionId).toBe('cs-next');

    // 失败那节课的数据仍完整地留在 backup 条目里
    const list = listCommitBackups(store);
    expect(list).toHaveLength(1);
    expect(list[0].payload.clientSessionId).toBe('cs-test');
  });

  it('a retried save for the SAME session overwrites its own backup (no duplicates)', () => {
    const store = memStore();
    const s = boot();
    backupOf(s, '2026-07-02 20:58:00', '2026-07-02 20:58:01', store);
    backupOf(s, '2026-07-02 21:10:00', '2026-07-02 21:10:01', store); // 重试，endedAt 更新
    const list = listCommitBackups(store);
    expect(list).toHaveLength(1);
    expect(list[0].payload.endedAt).toBe('2026-07-02 21:10:00');
  });

  it('lists newest-first and prunes the oldest beyond the cap', () => {
    const store = memStore();
    for (let i = 1; i <= 12; i++) {
      const s = { ...boot(), clientSessionId: `cs-${String(i).padStart(2, '0')}` };
      backupOf(s, '2026-07-02 20:00:00', `2026-07-0${i > 9 ? 2 : 1} ${String(10 + i)}:00:00`, store);
    }
    const list = listCommitBackups(store);
    expect(list).toHaveLength(10); // cap
    expect(list[0].payload.clientSessionId).toBe('cs-12'); // newest first
    expect(list.map((b) => b.payload.clientSessionId)).not.toContain('cs-01'); // oldest pruned
    expect(list.map((b) => b.payload.clientSessionId)).not.toContain('cs-02');
  });

  it('ignores corrupt backup entries instead of throwing', () => {
    const store = memStore();
    store.setItem('nce.classroom.backup.cs-bad', '{not json');
    backupOf(boot(), '2026-07-02 20:58:00', '2026-07-02 20:58:01', store);
    const list = listCommitBackups(store);
    expect(list).toHaveLength(1);
    expect(list[0].payload.clientSessionId).toBe('cs-test');
  });
});

describe('buildCommitPayload', () => {
  it('maps a finished session to the commit contract', () => {
    let s = boot();
    s = reducer(s, { type: 'scoreStudent', sid: 's1', d: 1, at: '2026-07-02 19:05:00' });
    s = reducer(s, { type: 'scoreGroup', gid: 'g2', d: 1, at: '2026-07-02 19:06:00' });
    s = reducer(s, { type: 'setRecite', sid: 's1', v: '已背完', at: '2026-07-02 19:07:00' });
    s = reducer(s, { type: 'setHomework', sid: 's2', v: '需补', at: '2026-07-02 19:08:00' });
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

    // events carry the group they fired in（第三条 = 背书自动加分，以普通事件下发）
    expect(p.events).toHaveLength(3);
    expect(p.events[0]).toEqual({
      targetType: 'student',
      targetId: 's1',
      clientGroupId: 'g1',
      delta: 1,
      createdAt: '2026-07-02 19:05:00',
    });
    expect(p.events[1]).toMatchObject({ targetType: 'group', targetId: 'g2', clientGroupId: 'g2', delta: 1 });
    expect(p.events[2]).toEqual({
      targetType: 'student',
      targetId: 's1',
      clientGroupId: 'g1',
      delta: 1,
      createdAt: '2026-07-02 19:07:00',
    });

    // only meaningful checks are sent: recite 非 null；作业非默认「没交」
    // （不发没交 = server 读侧「缺记录=没交」fallback，语义等价、payload 不膨胀）
    expect(p.checks).toContainEqual({ studentId: 's1', type: 'recitation', status: '已背完' });
    expect(p.checks).toContainEqual({ studentId: 's2', type: 'homework', status: '需补' });
    expect(p.checks).toHaveLength(2);
  });

  it('writes back the END-of-class grouping: in-class 调组 persists to the default', () => {
    let s = boot();
    // 小明(s1) 从 g1 调到 g2；丽丽(s5) 从 g2 调到 g1；缺席的小刚(s3) 仍留在 g1
    s = reducer(s, { type: 'moveStudent', sid: 's1', gid: 'g2' });
    s = reducer(s, { type: 'moveStudent', sid: 's5', gid: 'g1' });
    const groups = buildCommitPayload(s, '2026-07-02 20:58:00').defaultGrouping.groups;
    const g1 = groups.find((g) => g.clientId === 'g1')!;
    const g2 = groups.find((g) => g.clientId === 'g2')!;
    expect(g1.memberIds.sort()).toEqual(['s2', 's3', 's5']); // 小红 + 缺席小刚 + 调入的丽丽
    expect(g2.memberIds.sort()).toEqual(['s1']); // 只剩调入的小明
  });

  it('omits homework checks for the default「没交」— including students moved back to it', () => {
    let s = boot();
    s = reducer(s, { type: 'setHomework', sid: 's1', v: '完成', at: '2026-07-02 19:05:00' });
    s = reducer(s, { type: 'setHomework', sid: 's1', v: '没交', at: '2026-07-02 19:06:00' });
    const p = buildCommitPayload(s, '2026-07-02 20:58:00');
    expect(p.checks).toHaveLength(0); // 改回默认 = 等同没动过
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

describe('applyStartTime / startTimeOf (开始时间 dialog helpers)', () => {
  it('replaces only HH:mm, keeping the date and zeroing seconds', () => {
    expect(applyStartTime('2026-07-02 19:00:23', '09:05')).toBe('2026-07-02 09:05:00');
    expect(applyStartTime('2026-07-02 19:00:00', '23:59')).toBe('2026-07-02 23:59:00');
  });

  it('rejects an invalid HH:MM so callers keep the original startedAt', () => {
    expect(applyStartTime('2026-07-02 19:00:00', '24:00')).toBeNull();
    expect(applyStartTime('2026-07-02 19:00:00', '9:5')).toBeNull();
    expect(applyStartTime('2026-07-02 19:00:00', '')).toBeNull();
  });

  it("falls back to today's date when the stored startedAt is malformed (old/corrupt entry)", () => {
    expect(applyStartTime('garbage', '09:30')).toMatch(/^\d{4}-\d{2}-\d{2} 09:30:00$/);
  });

  it('extracts HH:MM for the time input, empty when malformed', () => {
    expect(startTimeOf('2026-07-02 19:00:00')).toBe('19:00');
    expect(startTimeOf('garbage')).toBe('');
  });
});

describe('nowSql', () => {
  it('formats a date as naive YYYY-MM-DD HH:mm:ss', () => {
    expect(nowSql(new Date(2026, 6, 2, 9, 5, 3))).toBe('2026-07-02 09:05:03');
  });
});

describe('补录课堂 (manual backfill)', () => {
  it('carries the backfill flag from meta onto the session, defaulting off', () => {
    expect(boot().backfill).toBeUndefined(); // a normal live session
    const b = buildClassroomSession(config(), { ...META, backfill: true });
    expect(b.backfill).toBe(true);
  });

  it('round-trips the flag through localStorage; an old archive reads as non-backfill', () => {
    const store = memStore();
    const b = buildClassroomSession(config(), { ...META, backfill: true });
    saveSession(b, store);
    expect(loadSession('c1', store)!.backfill).toBe(true);
    // 存档 shape 兼容：老版本没有 backfill 键 → 读成普通实时课
    const legacy = { ...boot() } as Record<string, unknown>;
    delete legacy.backfill;
    store.setItem('nce.classroom.c1', JSON.stringify(legacy));
    expect(loadSession('c1', store)!.backfill).toBeUndefined();
  });

  it('commits with endedAt = 开始 + 时长 (endSql), unlike a live session stamped at 结束', () => {
    const b = buildClassroomSession(config(), { ...META, backfill: true }); // startedAt 19:00, 120 分钟
    const p = buildCommitPayload(b, endSql(b.startedAt, b.plannedDurationMin));
    expect(p.startedAt).toBe('2026-07-02 19:00:00');
    expect(p.endedAt).toBe('2026-07-02 21:00:00');
  });
});

describe('sqlFromParts / endSql (补录 time helpers)', () => {
  it('composes a parseable started-at from a date + HH:MM', () => {
    expect(sqlFromParts('2026-07-03', '14:30')).toBe('2026-07-03 14:30:00');
  });

  it('falls back to 00:00 for a bad time and today for a bad date', () => {
    expect(sqlFromParts('2026-07-03', 'nope')).toBe('2026-07-03 00:00:00');
    expect(sqlFromParts('', '14:30')).toMatch(/^\d{4}-\d{2}-\d{2} 14:30:00$/);
  });

  it('endSql adds the duration in minutes, rolling across the hour/day boundary', () => {
    expect(endSql('2026-07-02 19:00:00', 120)).toBe('2026-07-02 21:00:00');
    expect(endSql('2026-07-02 23:30:00', 60)).toBe('2026-07-03 00:30:00');
  });
});

describe('buildEditSession (编辑上课记录: reopen a committed session)', () => {
  // A committed sess1-shaped ledger: 小明 +2 (背书 已背完), 小红 +1, 组 sg1 +1;
  // 小刚 请假(leave), 浩浩 缺席. Only the fields buildEditSession reads are set.
  function detail(): SessionDetail {
    return {
      id: 'sess1',
      classId: 'c1',
      className: '三年级A班',
      year: '2026',
      date: '06-26',
      lessonNumber: 7,
      lessonTitle: 'Too late',
      teacherId: 't-wangli',
      teacherName: '王莉',
      plannedDurationMin: 120,
      startedAt: '2026-06-26 19:00:00',
      endedAt: '2026-06-26 20:58:00',
      ledger: {
        clientSessionId: 'cs-orig',
        sessionGroups: [
          { id: 'sg2', name: '第2组', emoji: '🐯', orderIndex: 1 }, // out of order → sorted by orderIndex
          { id: 'sg1', name: '第1组', emoji: '🦁', orderIndex: 0 },
        ],
        memberships: [
          { studentId: 's1', name: '小明', sessionGroupId: 'sg1', attendance: 'present' },
          { studentId: 's2', name: '小红', sessionGroupId: 'sg1', attendance: 'present' },
          { studentId: 's3', name: '小刚', sessionGroupId: 'sg2', attendance: 'leave' },
          { studentId: 's4', name: '浩浩', sessionGroupId: null, attendance: 'absent' },
        ],
        events: [
          { targetType: 'student', targetId: 's1', sessionGroupId: 'sg1', delta: 1, createdAt: '2026-06-26 19:05:00' },
          { targetType: 'student', targetId: 's1', sessionGroupId: 'sg1', delta: 1, createdAt: '2026-06-26 19:06:00' },
          { targetType: 'student', targetId: 's2', sessionGroupId: 'sg1', delta: 1, createdAt: '2026-06-26 19:07:00' },
          { targetType: 'group', targetId: 'sg1', sessionGroupId: 'sg1', delta: 1, createdAt: '2026-06-26 19:08:00' },
        ],
        checks: [
          { studentId: 's1', type: 'recitation', status: '已背完' },
          { studentId: 's1', type: 'homework', status: '完成' },
          { studentId: 's2', type: 'recitation', status: '背完部分' },
        ],
        tags: [{ studentId: 's1', tag: '进步之星' }],
      },
    } as unknown as SessionDetail;
  }

  const def = () => [
    { clientId: 'g1', name: '第1组', emoji: '🦁', orderIndex: 0, memberIds: ['s1', 's2'] },
    { clientId: 'g2', name: '第2组', emoji: '🐯', orderIndex: 1, memberIds: ['s3'] },
  ];

  it('reconstructs meta + groups + students + score stream', () => {
    const s = buildEditSession(detail(), def());
    expect(s.editOfSessionId).toBe('sess1');
    expect(s.clientSessionId).toBe('cs-orig'); // original id preserved for the overwrite
    expect(s.backfill).toBe(true); // frozen timer (past class)
    expect(s.endedAt).toBe('2026-06-26 20:58:00'); // original duration kept
    expect(s.lessonNumber).toBe('7');
    expect(s.plannedDurationMin).toBe(120);
    expect(s.defaultGrouping).toEqual(def());
    // groups sorted by orderIndex, emoji '' when null
    expect(s.groups).toEqual([
      { id: 'sg1', name: '第1组', emoji: '🦁' },
      { id: 'sg2', name: '第2组', emoji: '🐯' },
    ]);
    // scores derived from the rebuilt event stream match the committed ledger
    expect(sScore(s.events, 's1')).toBe(2);
    expect(sScore(s.events, 's2')).toBe(1);
    expect(gScore(s.events, 'sg1')).toBe(4); // 小明2 + 小红1 + 组1
    expect(s.nid).toBe(s.events.length + 1);
  });

  it('maps checks / tags / attendance per student (leave → absent, 缺记录 = 没交)', () => {
    const byId = new Map(buildEditSession(detail(), def()).students.map((x) => [x.id, x]));
    expect(byId.get('s1')).toMatchObject({
      g: 'sg1',
      r: '已背完',
      h: '完成',
      tags: ['进步之星'],
      attendance: 'present',
    });
    expect(byId.get('s2')).toMatchObject({ r: '背完部分', h: '没交', attendance: 'present' });
    expect(byId.get('s3')).toMatchObject({ g: 'sg2', attendance: 'absent' }); // leave folded to absent, keeps group
    expect(byId.get('s4')).toMatchObject({ g: '', attendance: 'absent' });
  });

  it('re-marks the 已背完 bonus so a 背书 toggle removes/re-adds exactly one point', () => {
    const s = buildEditSession(detail(), def());
    const recite = s.events.filter((e) => e.src === 'recite');
    expect(recite).toHaveLength(1);
    expect(recite[0]).toMatchObject({ tt: 'student', tid: 's1', d: 1 });

    // toggle 背书 off → the bonus point is withdrawn (net 2 → 1)
    const off = reducer(s, { type: 'setRecite', sid: 's1', v: '没背', at: '2026-06-26 19:10:00' });
    expect(sScore(off.events, 's1')).toBe(1);
    // toggle back on → the point is re-issued exactly once (net 1 → 2)
    const on = reducer(off, { type: 'setRecite', sid: 's1', v: '已背完', at: '2026-06-26 19:11:00' });
    expect(sScore(on.events, 's1')).toBe(2);
  });

  it('round-trips through buildCommitPayload without losing scores/checks/tags/attendance', () => {
    const s = buildEditSession(detail(), def());
    const payload = buildCommitPayload(s, '2026-06-26 20:58:00');
    expect(payload.clientSessionId).toBe('cs-orig');
    expect(payload.events).toHaveLength(4);
    // per-target net deltas survive the rebuild
    const net = (tid: string) => payload.events.filter((e) => e.targetId === tid).reduce((a, e) => a + e.delta, 0);
    expect(net('s1')).toBe(2);
    expect(net('s2')).toBe(1);
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        { studentId: 's1', type: 'recitation', status: '已背完' },
        { studentId: 's1', type: 'homework', status: '完成' },
        { studentId: 's2', type: 'recitation', status: '背完部分' },
      ]),
    );
    expect(payload.tags).toEqual([{ studentId: 's1', tag: '进步之星' }]);
    const att = new Map(payload.memberships.map((m) => [m.studentId, m.attendance]));
    expect(att.get('s1')).toBe('present');
    expect(att.get('s3')).toBe('absent');
    expect(att.get('s4')).toBe('absent');
    // absent students commit with a null group regardless of the board-side g
    expect(payload.memberships.find((m) => m.studentId === 's3')?.clientGroupId).toBeNull();
  });
});

// Keep an unused ClassroomSession reference to pin the exported type name.
export type _Pin = ClassroomSession;
