import { describe, expect, it } from 'vitest';
import type { ClassAttendance, MakeupRecord } from '../api/attendance';
import { attendance } from '../test-utils/fixtures';
import { coverageMap, makeupCandidates, validateMakeupForm, formatMakeupSessions, makeupListRows } from './makeup';
import { buildAttendanceCsv, recordKey, rowCells, rowStats, rowTag } from './attendance';

export const record: MakeupRecord = {
  id: 'mk1',
  studentId: 's1',
  studentName: 'Tom',
  studentStatus: 'active',
  date: '2026-11-09',
  durationMinutes: 60,
  note: null,
  createdByName: '王莉',
  createdAt: '2026-11-09 10:00:00',
  sessionIds: ['a', 'b', 'c'],
};
const data: ClassAttendance = attendance({
  sessions: ['a', 'b', 'c', 'd'].map((id, i) => ({
    id,
    date: `2026-09-0${i + 1}`,
    startedAt: null,
    lessonNumber: i + 1,
    lessonTitle: 'Lesson',
  })),
  records: [
    { sessionId: 'b', studentId: 's1', status: 'absent' },
    { sessionId: 'c', studentId: 's1', status: 'leave' },
    { sessionId: 'd', studentId: 's1', status: 'present' },
  ],
  makeups: [],
});

describe('makeup derivations', () => {
  it('offers off/absent/leave chronologically, excludes present and other coverage, includes own editing coverage', () => {
    expect(makeupCandidates(data, 's1').map((c) => c.reason)).toEqual(['off', 'absent', 'leave']);
    const covered = { ...data, makeups: [record] };
    expect(coverageMap(covered.makeups).get(recordKey('a', 's1'))).toEqual(record);
    expect(makeupCandidates(covered, 's1')).toEqual([]);
    expect(makeupCandidates(covered, 's1', 'mk1').map((c) => c.checked)).toEqual([true, true, true]);
  });
  it('validates each field and legacy null duration, allowing an empty selection', () => {
    const draft = { studentId: 's1', date: '2026-11-09', durationMinutes: '60', sessionIds: ['a'], note: '' };
    expect(validateMakeupForm(draft, { durationRequired: true })).toEqual({});
    for (const durationMinutes of ['', '0', '-1', '601', '1.5', 'abc'])
      expect(
        validateMakeupForm({ ...draft, durationMinutes }, { durationRequired: true }).durationMinutes,
      ).toBeTruthy();
    expect(validateMakeupForm({ ...draft, sessionIds: [] }, { durationRequired: true })).toEqual({});
    const invalid = validateMakeupForm({ ...draft, studentId: '', date: '', sessionIds: [] }, { durationRequired: true });
    expect(invalid).toMatchObject({ studentId: expect.any(String), date: expect.any(String) });
    expect(invalid).not.toHaveProperty('sessionIds');
    expect(validateMakeupForm({ ...draft, durationMinutes: '' }, { durationRequired: false })).toEqual({});
  });
  it('formats lessons, empty coverage, sorts records and includes archived students only with history', () => {
    expect(formatMakeupSessions(record, data.sessions)).toBe('9/1 L1 · 9/2 L2 · 9/3 L3');
    expect(formatMakeupSessions({ ...record, sessionIds: [] }, data.sessions)).toBe('未抵扣任何课');
    const archived = {
      ...record,
      id: 'mk2',
      studentId: 's9',
      studentName: 'Jerry',
      studentStatus: 'archived' as const,
      date: '2026-11-10',
    };
    const rows = makeupListRows({ ...data, makeups: [record, archived] }, 's9');
    expect(rows.records).toEqual([archived]);
    expect(rows.students).toContainEqual({ id: 's9', name: 'Jerry', status: 'archived' });
    expect(makeupListRows({ ...data, makeups: [record, archived] }, '').records.map((r) => r.id)).toEqual([
      'mk2',
      'mk1',
    ]);
  });
  it('counts covered off-roster lessons without changing the late-join tag, exports original reasons', () => {
    const withMakeup = { ...data, makeups: [record] };
    const cells = rowCells(
      's1',
      data.sessions,
      new Map(data.records.map((r) => [recordKey(r.sessionId, r.studentId), r])),
      coverageMap([record]),
    );
    expect(rowStats(cells)).toMatchObject({ sched: 4, pres: 4, madeUp: 3, rate: 100 });
    expect(rowTag('active', cells)).toBe('插班');
    expect(buildAttendanceCsv(withMakeup)).toContain('未在班（已补课）,缺勤（已补课）,请假（已补课）,出勤,100%');
    expect(rowStats(rowCells('s1', data.sessions, new Map(), new Map()))).toMatchObject({ sched: 0, pres: 0 });
    const defensive = rowCells('s1', data.sessions, new Map([['a:s1', { status: 'present' }]]), coverageMap([record]));
    expect(defensive[0].makeup).toBeNull();
  });
});
