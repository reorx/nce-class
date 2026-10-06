import { describe, expect, it } from 'vitest';
import { classDetail, sessionDetail, student } from '../test-utils/fixtures';
import { bootPlan, settleBoot } from './classroomBoot';
import { buildClassroomSession, type ClassroomSession } from './classroomStore';
import { configFromDetail } from './setup';

// 进入课堂页的判定（kb/docs/classroom-session-lifecycle.md「进入课堂页的判定顺序」）：
// 本地课堂恢复 → 编辑冲突 → edit_id → URL 直接开课 → 课前配置。B14 / B15 的纯逻辑部分。

const detail = classDetail({
  students: [student({ groupId: 'g1' }), student({ id: 's2', name: 'Amy', groupId: null })],
  groups: [{ id: 'g1', name: '海豚组', emoji: '🐬', orderIndex: 0, memberIds: ['s1'] }],
});

const live = (over: Partial<ClassroomSession> = {}): ClassroomSession => ({
  ...buildClassroomSession(
    configFromDetail(detail, { lessonNumber: '7', lessonTitle: '', durationMin: 120, className: detail.name }),
    { classId: 'c1', clientSessionId: 'cs-live', startedAt: '2026-10-07 18:00:00' },
  ),
  ...over,
});

describe('bootPlan', () => {
  it('a stored classroom always wins and needs no server (B14)', () => {
    const s = live();
    expect(bootPlan(s, '')).toEqual({ kind: 'resume', session: s });
    expect(bootPlan(s, '?lesson=4&title=x')).toEqual({ kind: 'resume', session: s });
  });

  it('edit_id of a different session than the stored one is a conflict; the same one resumes its draft (B15)', () => {
    expect(bootPlan(live(), '?edit_id=x1')).toEqual({ kind: 'conflict' });
    const draft = live({ editOfSessionId: 'x1' });
    expect(bootPlan(draft, '?edit_id=x1')).toEqual({ kind: 'resume', session: draft });
    expect(bootPlan(draft, '?edit_id=x2')).toEqual({ kind: 'conflict' });
  });

  it('without a stored classroom: edit_id → edit, lesson params → url boot, nothing → setup', () => {
    expect(bootPlan(null, '?edit_id=x1')).toEqual({ kind: 'edit', editId: 'x1' });
    expect(bootPlan(null, '?lesson=L4&title=Hi&duration=90')).toEqual({
      kind: 'url',
      lessonNumber: '4',
      lessonTitle: 'Hi',
      durationMin: 90,
    });
    expect(bootPlan(null, '?title=Hi')).toMatchObject({ kind: 'url', durationMin: 120 });
    expect(bootPlan(null, '')).toEqual({ kind: 'setup' });
  });
});

describe('settleBoot (server data arrived)', () => {
  const ctx = { classId: 'c1', classDetail: detail, clientSessionId: () => 'cs-new', now: '2026-10-07 19:00:00' };

  it('url boot creates one fresh classroom from the latest roster', () => {
    const r = settleBoot({ kind: 'url', lessonNumber: '8', lessonTitle: '', durationMin: 120 }, { ...ctx, stored: null });
    expect(r.kind).toBe('create');
    const s = (r as { session: ClassroomSession }).session;
    expect(s.clientSessionId).toBe('cs-new');
    expect(s.students.map((x) => x.id).sort()).toEqual(['s1', 's2']);
  });

  it('re-checks storage first: a classroom stored in the meantime is resumed, never overwritten (StrictMode / late reply)', () => {
    const stored = live();
    const r = settleBoot({ kind: 'url', lessonNumber: '8', lessonTitle: '', durationMin: 120 }, { ...ctx, stored });
    expect(r).toEqual({ kind: 'resume', session: stored });
    expect(settleBoot({ kind: 'edit', editId: 'x1' }, { ...ctx, stored, sessionDetail: sessionDetail() })).toEqual({
      kind: 'conflict',
    });
  });

  it('edit: rebuilds from the session ledger, keeping the record id; a session of another class redirects', () => {
    const r = settleBoot({ kind: 'edit', editId: 'x1' }, { ...ctx, stored: null, sessionDetail: sessionDetail() });
    expect(r.kind).toBe('create');
    expect((r as { session: ClassroomSession }).session.editOfSessionId).toBe('x1');
    expect(
      settleBoot(
        { kind: 'edit', editId: 'x1' },
        { ...ctx, stored: null, sessionDetail: sessionDetail({ classId: 'c2' }) },
      ),
    ).toEqual({ kind: 'redirect' });
  });
});
