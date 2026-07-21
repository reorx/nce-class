import { describe, expect, it } from 'vitest';
import {
  buildBatchSnapshot,
  computeAmountCents,
  computeStudentCounts,
  scheduleRange,
  type MembershipRecord,
} from './billing.js';

// 周期：7/01、7/03、7/05 已过去，7/10、7/12 未来（today=2026-07-08）
const LESSONS = [
  { date: '2026-07-01' },
  { date: '2026-07-03' },
  { date: '2026-07-05' },
  { date: '2026-07-10' },
  { date: '2026-07-12' },
];
const TODAY = '2026-07-08';

const mem = (sessionId: string, studentId: string, attendance = 'present', madeUp = 0): MembershipRecord => ({
  sessionId,
  studentId,
  attendance,
  madeUp,
});

describe('scheduleRange', () => {
  it('derives min/max from lessons', () => {
    expect(scheduleRange(LESSONS)).toEqual({ minDate: '2026-07-01', maxDate: '2026-07-12' });
  });

  it('returns null for an empty lesson list', () => {
    expect(scheduleRange([])).toBeNull();
  });
});

describe('computeStudentCounts', () => {
  const base = { studentId: 's1', status: 'active', lessons: LESSONS, today: TODAY };

  it('counts present sessions as attended and future lessons as planned', () => {
    const counts = computeStudentCounts({
      ...base,
      sessions: [
        { id: 'x1', date: '2026-07-01' },
        { id: 'x2', date: '2026-07-03' },
      ],
      memberships: [mem('x1', 's1'), mem('x2', 's1', 'absent')],
    });
    // 到堂 1（x1）+ 未来 2 节（7/10、7/12）
    expect(counts).toEqual({ attendedCount: 1, plannedCount: 2, billableCount: 3 });
  });

  it('counts absent-but-madeUp as attended (决策 2)', () => {
    const counts = computeStudentCounts({
      ...base,
      sessions: [{ id: 'x1', date: '2026-07-01' }],
      memberships: [mem('x1', 's1', 'absent', 1)],
    });
    expect(counts.attendedCount).toBe(1);
  });

  it('does not bill leave without makeup (请假未补不收)', () => {
    const counts = computeStudentCounts({
      ...base,
      sessions: [{ id: 'x1', date: '2026-07-01' }],
      memberships: [mem('x1', 's1', 'leave', 0)],
    });
    expect(counts.attendedCount).toBe(0);
  });

  it('counts 0 for a session the student has no membership in (中途入班)', () => {
    const counts = computeStudentCounts({
      ...base,
      sessions: [
        { id: 'x1', date: '2026-07-01' },
        { id: 'x2', date: '2026-07-03' },
      ],
      memberships: [mem('x2', 's1')], // x1 早于入班，无快照行
    });
    expect(counts.attendedCount).toBe(1);
  });

  it('ignores sessions outside the schedule range', () => {
    const counts = computeStudentCounts({
      ...base,
      sessions: [
        { id: 'pre', date: '2026-06-20' },
        { id: 'in', date: '2026-07-03' },
      ],
      memberships: [mem('pre', 's1'), mem('in', 's1')],
    });
    expect(counts.attendedCount).toBe(1);
  });

  it('counts an ad-hoc session inside the range even if its date is not a planned lesson (临时加课)', () => {
    const counts = computeStudentCounts({
      ...base,
      sessions: [{ id: 'adhoc', date: '2026-07-02' }], // 7/02 不在排班里
      memberships: [mem('adhoc', 's1')],
    });
    expect(counts.attendedCount).toBe(1);
  });

  it('past planned days with no session simply do not bill (临时取消不收钱)', () => {
    const counts = computeStudentCounts({ ...base, sessions: [], memberships: [] });
    // 7/01、7/03、7/05 已过去且没上课 → 0；planned 只算 7/10、7/12
    expect(counts).toEqual({ attendedCount: 0, plannedCount: 2, billableCount: 2 });
  });

  it('a today-lesson counts as planned only when no session happened today (当天课去重)', () => {
    const lessons = [...LESSONS, { date: TODAY }];
    const before = computeStudentCounts({ ...base, lessons, sessions: [], memberships: [] });
    expect(before.plannedCount).toBe(3); // 7/08(今天) + 7/10 + 7/12

    const after = computeStudentCounts({
      ...base,
      lessons,
      sessions: [{ id: 'x-today', date: TODAY }],
      memberships: [mem('x-today', 's1')],
    });
    expect(after.attendedCount).toBe(1);
    expect(after.plannedCount).toBe(2); // 今天已有 session → 当天排班不再计 planned
  });

  it('today with two planned lessons but one session held: the remaining lesson counts 0 (边界，接受)', () => {
    const lessons = [{ date: TODAY }, { date: TODAY }, { date: '2026-07-12' }];
    const counts = computeStudentCounts({
      ...base,
      lessons,
      sessions: [{ id: 'x-today', date: TODAY }],
      memberships: [mem('x-today', 's1')],
    });
    expect(counts).toEqual({ attendedCount: 1, plannedCount: 1, billableCount: 2 });
  });

  it('forces plannedCount to 0 for suspended/archived students (只结已上部分)', () => {
    for (const status of ['suspended', 'archived']) {
      const counts = computeStudentCounts({
        ...base,
        status,
        sessions: [{ id: 'x1', date: '2026-07-01' }],
        memberships: [mem('x1', 's1')],
      });
      expect(counts).toEqual({ attendedCount: 1, plannedCount: 0, billableCount: 1 });
    }
  });

  it('returns all zeros when the schedule has no lessons', () => {
    const counts = computeStudentCounts({
      ...base,
      lessons: [],
      sessions: [{ id: 'x1', date: '2026-07-01' }],
      memberships: [mem('x1', 's1')],
    });
    expect(counts).toEqual({ attendedCount: 0, plannedCount: 0, billableCount: 0 });
  });
});

describe('computeAmountCents', () => {
  it('charges unit × billable + addon', () => {
    expect(computeAmountCents({ unitPriceCents: 10000, billableCount: 7, addonCents: 3000 })).toBe(73000);
  });

  it('charges nothing at all when billable is 0 — addon included (决策：完全没参与不收书本费)', () => {
    expect(computeAmountCents({ unitPriceCents: 10000, billableCount: 0, addonCents: 3000 })).toBe(0);
  });
});

describe('buildBatchSnapshot (建单学生范围)', () => {
  const sessions = [{ id: 'x1', date: '2026-07-01' }];

  it('includes every active student (even billable=0) and non-active only with attended>0', () => {
    const rows = buildBatchSnapshot({
      students: [
        { id: 's-active', status: 'active' }, // 全新 active，billable=0 也建
        { id: 's-susp-in', status: 'suspended' }, // 停课但周期内上过 → 建
        { id: 's-susp-out', status: 'suspended' }, // 停课且没上过 → 不建
        { id: 's-arch-out', status: 'archived' }, // 归档且没上过 → 不建
      ],
      lessons: [{ date: '2026-07-01' }], // 全部过去 → active 学生 planned=0
      sessions,
      memberships: [mem('x1', 's-susp-in')],
      today: TODAY,
    });
    expect(rows.map((r) => r.studentId)).toEqual(['s-active', 's-susp-in']);
    expect(rows[0]).toEqual({ studentId: 's-active', attendedCount: 0, plannedCount: 0, billableCount: 0 });
    expect(rows[1]).toEqual({ studentId: 's-susp-in', attendedCount: 1, plannedCount: 0, billableCount: 1 });
  });

  it('keeps input student order for the created invoices', () => {
    const rows = buildBatchSnapshot({
      students: [
        { id: 'b', status: 'active' },
        { id: 'a', status: 'active' },
      ],
      lessons: LESSONS,
      sessions: [],
      memberships: [],
      today: TODAY,
    });
    expect(rows.map((r) => r.studentId)).toEqual(['b', 'a']);
  });
});
