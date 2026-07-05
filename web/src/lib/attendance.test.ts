import { describe, expect, it } from 'vitest';
import type { ClassAttendance } from './api';
import {
  buildAttendanceCsv,
  classAttendanceStats,
  dateParts,
  rateColor,
  recordKey,
  rowCells,
  rowStats,
  rowTag,
  weekdayCN,
} from './attendance';

const FIX: ClassAttendance = {
  classId: 'c1',
  className: '三年级A班',
  sessions: [
    { id: 'k1', date: '2026-06-06', startedAt: '2026-06-06 14:30:00', lessonNumber: 5, lessonTitle: null },
    { id: 'k2', date: '2026-06-13', startedAt: null, lessonNumber: 6, lessonTitle: null },
    { id: 'k3', date: '2026-06-20', startedAt: null, lessonNumber: 7, lessonTitle: null },
  ],
  students: [
    { id: 's1', name: '小明', status: 'active' },
    { id: 's2', name: '大壮', status: 'suspended' },
    { id: 's3', name: '婷婷', status: 'active' },
  ],
  records: [
    { sessionId: 'k1', studentId: 's1', status: 'present', madeUp: false },
    { sessionId: 'k2', studentId: 's1', status: 'present', madeUp: false },
    { sessionId: 'k3', studentId: 's1', status: 'absent', madeUp: true },
    { sessionId: 'k1', studentId: 's2', status: 'present', madeUp: false },
    { sessionId: 'k2', studentId: 's2', status: 'leave', madeUp: false },
    // s2 dropped out before k3 → no record (off cell)
    // s3 joined late → no record for k1
    { sessionId: 'k2', studentId: 's3', status: 'present', madeUp: false },
    { sessionId: 'k3', studentId: 's3', status: 'present', madeUp: false },
  ],
};

const map = new Map(FIX.records.map((r) => [recordKey(r.sessionId, r.studentId), r]));
const cellsOf = (sid: string) => rowCells(sid, FIX.sessions, map);

describe('rowCells', () => {
  it('maps records into cells and leaves gaps as off (status null)', () => {
    expect(cellsOf('s1')).toEqual([
      { status: 'present', madeUp: false },
      { status: 'present', madeUp: false },
      { status: 'absent', madeUp: true },
    ]);
    expect(cellsOf('s3')[0]).toEqual({ status: null, madeUp: false });
  });
});

describe('rowStats', () => {
  it('counts made-up absences as attended for the rate', () => {
    const st = rowStats(cellsOf('s1'));
    expect(st).toEqual({ sched: 3, pres: 3, absent: 1, leave: 0, madeUp: 1, rate: 100, full: true });
  });

  it('excludes off cells from the schedule', () => {
    const st = rowStats(cellsOf('s2'));
    expect(st).toEqual({ sched: 2, pres: 1, absent: 0, leave: 1, madeUp: 0, rate: 50, full: false });
  });

  it('yields a null rate for a student with no records at all', () => {
    const st = rowStats(rowCells('ghost', FIX.sessions, map));
    expect(st.sched).toBe(0);
    expect(st.rate).toBeNull();
    expect(st.full).toBe(false);
  });
});

describe('rateColor', () => {
  it('follows the design thresholds', () => {
    expect(rateColor(null)).toBe('#c2cabb');
    expect(rateColor(100)).toBe('#2fb457');
    expect(rateColor(90)).toBe('#2fb457');
    expect(rateColor(89)).toBe('#e0912a');
    expect(rateColor(75)).toBe('#e0912a');
    expect(rateColor(74)).toBe('#e0454a');
  });
});

describe('rowTag', () => {
  it('marks suspended students 停课, late joiners 插班', () => {
    expect(rowTag('suspended', cellsOf('s2'))).toBe('停课');
    expect(rowTag('active', cellsOf('s3'))).toBe('插班');
    expect(rowTag('active', cellsOf('s1'))).toBeNull();
    // no records at all → not 插班
    expect(rowTag('active', rowCells('ghost', FIX.sessions, map))).toBeNull();
  });
});

describe('classAttendanceStats', () => {
  it('averages only rows with a schedule and counts full attendance', () => {
    const stats = [cellsOf('s1'), cellsOf('s2'), cellsOf('s3')].map(rowStats);
    expect(classAttendanceStats(stats)).toEqual({ avg: 83, full: 2 });
    expect(classAttendanceStats([])).toEqual({ avg: 0, full: 0 });
  });
});

describe('date helpers', () => {
  it('splits and labels dates', () => {
    expect(dateParts('2026-06-06')).toEqual({ mm: 6, dd: 6 });
    expect(weekdayCN('2026-06-06')).toBe('周六'); // 2026-06-06 is a Saturday
    expect(weekdayCN('2026-07-01')).toBe('周三');
  });
});

describe('buildAttendanceCsv', () => {
  it('renders one row per student with readable marks and the rate', () => {
    const csv = buildAttendanceCsv(FIX);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('学生,6/6,6/13,6/20,出勤率');
    expect(lines[1]).toBe('小明,出勤,出勤,缺勤（已补课）,100%');
    expect(lines[2]).toBe('大壮,出勤,请假,—,50%');
    expect(lines[3]).toBe('婷婷,—,出勤,出勤,100%');
  });
});
