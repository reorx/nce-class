import type { ClassAttendance, MakeupRecord, AttendanceSession, AttendanceStudent } from '../api/attendance';
import { dateParts, recordKey } from './attendance';

export function coverageMap(makeups: MakeupRecord[]): Map<string, MakeupRecord> {
  return new Map(makeups.flatMap((r) => r.sessionIds.map((id) => [recordKey(id, r.studentId), r] as const)));
}

export function makeupCandidates(
  data: ClassAttendance,
  studentId: string,
  editingId?: string,
): { session: AttendanceSession; reason: 'absent' | 'leave' | 'off'; checked: boolean }[] {
  const records = new Map(data.records.map((r) => [recordKey(r.sessionId, r.studentId), r]));
  const coverage = coverageMap(data.makeups);
  return [...data.sessions]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))
    .flatMap((session) => {
      const key = recordKey(session.id, studentId);
      const status = records.get(key)?.status;
      const makeup = coverage.get(key);
      if (status === 'present' || (makeup && makeup.id !== editingId)) return [];
      return [{ session, reason: status ?? 'off', checked: !!makeup && makeup.id === editingId }];
    });
}

export interface MakeupDraft {
  studentId: string;
  date: string;
  durationMinutes: string;
  sessionIds: string[];
  note: string;
}

export function validateMakeupForm(draft: MakeupDraft, options: { durationRequired: boolean }) {
  const errors: Partial<Record<keyof MakeupDraft, string>> = {};
  if (!draft.studentId) errors.studentId = '请选择学生';
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(draft.date)) errors.date = '请填写有效的补课日期';
  const duration = Number(draft.durationMinutes);
  if (
    (options.durationRequired || draft.durationMinutes !== '') &&
    (!Number.isInteger(duration) || duration < 1 || duration > 600)
  )
    errors.durationMinutes = '请填写 1–600 的正整数';
  return errors;
}

export function formatMakeupSessions(record: MakeupRecord, sessions: AttendanceSession[]): string {
  if (!record.sessionIds.length) return '未抵扣任何课';
  const ids = new Set(record.sessionIds);
  return sessions
    .filter((s) => ids.has(s.id))
    .map((s) => {
      const { mm, dd } = dateParts(s.date);
      return `${mm}/${dd}${s.lessonNumber == null ? '' : ` L${s.lessonNumber}`}`;
    })
    .join(' · ');
}

export function makeupListRows(data: ClassAttendance, studentFilter: string) {
  const students = new Map<string, Pick<AttendanceStudent, 'id' | 'name' | 'status'>>(
    data.students.map((s) => [s.id, { id: s.id, name: s.name, status: s.status }]),
  );
  for (const r of data.makeups)
    if (!students.has(r.studentId))
      students.set(r.studentId, { id: r.studentId, name: r.studentName, status: r.studentStatus });
  const records = data.makeups
    .filter((r) => !studentFilter || r.studentId === studentFilter)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return { students: [...students.values()], records };
}
