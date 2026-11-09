import { get, request, type RequestOptions } from './client';
import type { StudentStatus } from './students';

// ---- 考勤 (attendance history grid) ----
export type AttendanceStatus = 'present' | 'absent' | 'leave';

export interface AttendanceSession {
  id: string;
  date: string; // YYYY-MM-DD
  startedAt: string | null;
  lessonNumber: number | null;
  lessonTitle: string | null;
}

export interface AttendanceStudent {
  id: string;
  name: string;
  cnName: string | null; // 类型跟随；考勤网格不显示中文名（格子太窄）
  status: StudentStatus;
}

export interface AttendanceRecord {
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
}

export interface MakeupRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentStatus: StudentStatus;
  date: string;
  durationMinutes: number | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
  sessionIds: string[];
}

export interface AttendanceUpdateResult extends AttendanceRecord {
  unlinkedMakeupId: string | null;
}

export interface MakeupInput {
  studentId?: string;
  date: string;
  durationMinutes: number | null;
  note: string | null;
  sessionIds: string[];
}

export interface ClassAttendance {
  classId: string;
  className: string;
  sessions: AttendanceSession[];
  students: AttendanceStudent[];
  records: AttendanceRecord[];
  makeups: MakeupRecord[];
}

export interface AttendanceInput {
  status: AttendanceStatus;
}

export const getClassAttendance = (classId: string, options?: RequestOptions) =>
  get<ClassAttendance>(`/api/classes/${classId}/attendance`, options);

/** 考勤更正（leave 只由这里产生）；改回 present 时原子解除补课抵扣。 */
export const updateAttendance = (sessionId: string, studentId: string, input: AttendanceInput) =>
  request<AttendanceUpdateResult>('PUT', `/api/sessions/${sessionId}/attendance/${studentId}`, input);

export const createMakeup = (classId: string, input: MakeupInput) =>
  request<MakeupRecord>('POST', `/api/classes/${classId}/makeups`, input);
export const updateMakeup = (id: string, input: MakeupInput) =>
  request<MakeupRecord>('PUT', `/api/makeups/${id}`, input);
export const deleteMakeup = (id: string) => request<{ ok: true }>('DELETE', `/api/makeups/${id}`);
