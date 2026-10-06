import { describe, expect, it } from 'vitest';
import {
  buildBatchSnapshot,
  computeAmountCents,
  computeAttendedCount,
  computeBatchCounts,
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

describe('computeBatchCounts（批次级节数，全班一致）', () => {
  const base = { lessons: LESSONS, today: TODAY };

  it('bills the schedule lesson count when no override is set', () => {
    const counts = computeBatchCounts({ ...base, sessions: [{ id: 'x1', date: '2026-07-01' }] });
    expect(counts).toEqual({ lessonCount: 5, heldCount: 1, futureCount: 2 });
  });

  it('bills the override when set: future = override − 已上节数', () => {
    const sessions = [
      { id: 'x1', date: '2026-07-01' },
      { id: 'x2', date: '2026-07-02' }, // 排班外临时加课，占用总量
      { id: 'x3', date: '2026-07-03' },
    ];
    expect(computeBatchCounts({ ...base, sessions, lessonCountOverride: 8 })).toEqual({
      lessonCount: 8,
      heldCount: 3,
      futureCount: 5,
    });
    // 已上超过覆盖次数 → 未上归 0
    expect(computeBatchCounts({ ...base, sessions, lessonCountOverride: 2 }).futureCount).toBe(0);
  });

  it('counts only sessions inside the schedule range as held', () => {
    const counts = computeBatchCounts({
      ...base,
      sessions: [
        { id: 'pre', date: '2026-06-20' },
        { id: 'in', date: '2026-07-03' },
      ],
    });
    expect(counts.heldCount).toBe(1);
  });

  it('a today-lesson is future only when no session happened today (当天课去重)', () => {
    const lessons = [...LESSONS, { date: TODAY }];
    expect(computeBatchCounts({ ...base, lessons, sessions: [] }).futureCount).toBe(3);
    expect(computeBatchCounts({ ...base, lessons, sessions: [{ id: 't', date: TODAY }] }).futureCount).toBe(2);
  });

  it('returns all zeros when the schedule has no lessons', () => {
    expect(computeBatchCounts({ lessons: [], sessions: [{ id: 'x1', date: '2026-07-01' }], today: TODAY })).toEqual(
      { lessonCount: 0, heldCount: 0, futureCount: 0 },
    );
  });
});

describe('computeAttendedCount（已上到堂，仅展示）', () => {
  const base = { studentId: 's1', lessons: LESSONS };

  it('counts present and absent-but-madeUp; leave/absent without makeup do not count', () => {
    const n = computeAttendedCount({
      ...base,
      sessions: [
        { id: 'x1', date: '2026-07-01' },
        { id: 'x2', date: '2026-07-03' },
        { id: 'x3', date: '2026-07-05' },
        { id: 'x4', date: '2026-07-02' }, // 临时加课
      ],
      memberships: [
        mem('x1', 's1'),
        mem('x2', 's1', 'absent', 1),
        mem('x3', 's1', 'leave'),
        mem('x4', 's1', 'absent'),
      ],
    });
    expect(n).toBe(2);
  });

  it('counts 0 for a session the student has no membership in (中途入班)', () => {
    const n = computeAttendedCount({
      ...base,
      sessions: [
        { id: 'x1', date: '2026-07-01' },
        { id: 'x2', date: '2026-07-03' },
      ],
      memberships: [mem('x2', 's1')],
    });
    expect(n).toBe(1);
  });

  it('ignores sessions outside the schedule range', () => {
    const n = computeAttendedCount({
      ...base,
      sessions: [
        { id: 'pre', date: '2026-06-20' },
        { id: 'in', date: '2026-07-03' },
      ],
      memberships: [mem('pre', 's1'), mem('in', 's1')],
    });
    expect(n).toBe(1);
  });
});

describe('computeStudentCounts（收款单快照：计费节数不看出勤）', () => {
  const base = { studentId: 's1', lessons: LESSONS, today: TODAY };
  const sessions = [
    { id: 'x1', date: '2026-07-01' },
    { id: 'x2', date: '2026-07-03' },
  ];

  it('bills every student the batch lesson count regardless of attendance', () => {
    const full = computeStudentCounts({ ...base, sessions, memberships: [mem('x1', 's1'), mem('x2', 's1')] });
    const missed = computeStudentCounts({ ...base, sessions, memberships: [mem('x2', 's1', 'absent')] });
    const lateJoiner = computeStudentCounts({ ...base, sessions, memberships: [] });
    expect(full).toEqual({ attendedCount: 2, plannedCount: 2, billableCount: 5 });
    expect(missed).toEqual({ attendedCount: 0, plannedCount: 2, billableCount: 5 });
    expect(lateJoiner).toEqual({ attendedCount: 0, plannedCount: 2, billableCount: 5 });
  });

  it('bills the override for everyone, absences included', () => {
    const counts = computeStudentCounts({
      ...base,
      sessions,
      memberships: [mem('x1', 's1', 'absent')],
      lessonCountOverride: 18,
    });
    expect(counts).toEqual({ attendedCount: 0, plannedCount: 16, billableCount: 18 });
  });
});

describe('computeAmountCents', () => {
  it('charges unit × billable + addon', () => {
    expect(computeAmountCents({ unitPriceCents: 13000, billableCount: 18, addonCents: 6000 })).toBe(240000);
  });
});

describe('buildBatchSnapshot (建单学生范围)', () => {
  const sessions = [{ id: 'x1', date: '2026-07-01' }];

  it('includes every active student and non-active only with attended>0, all at the batch lesson count', () => {
    const rows = buildBatchSnapshot({
      students: [
        { id: 's-active', status: 'active' }, // 没上过也建
        { id: 's-susp-in', status: 'suspended' }, // 停课但周期内上过 → 建
        { id: 's-susp-out', status: 'suspended' }, // 停课且没上过 → 不建
        { id: 's-arch-out', status: 'archived' }, // 归档且没上过 → 不建
      ],
      lessons: [{ date: '2026-07-01' }],
      sessions,
      memberships: [mem('x1', 's-susp-in')],
      today: TODAY,
    });
    expect(rows).toEqual([
      { studentId: 's-active', attendedCount: 0, plannedCount: 0, billableCount: 1 },
      { studentId: 's-susp-in', attendedCount: 1, plannedCount: 0, billableCount: 1 },
    ]);
  });

  it('carries the override through', () => {
    const rows = buildBatchSnapshot({
      students: [{ id: 's1', status: 'active' }],
      lessons: LESSONS,
      sessions,
      memberships: [],
      today: TODAY,
      lessonCountOverride: 8,
    });
    expect(rows).toEqual([{ studentId: 's1', attendedCount: 0, plannedCount: 7, billableCount: 8 }]);
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
