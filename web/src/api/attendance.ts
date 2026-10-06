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
  madeUp: boolean;
}

export interface ClassAttendance {
  classId: string;
  className: string;
  sessions: AttendanceSession[];
  students: AttendanceStudent[];
  records: AttendanceRecord[];
}

export interface AttendanceInput {
  status: AttendanceStatus;
  madeUp?: boolean;
}

export const getClassAttendance = (classId: string, options?: RequestOptions) =>
  get<ClassAttendance>(`/api/classes/${classId}/attendance`, options);

/** 考勤更正（leave 只由这里产生）；补课只对未到堂有效，改回 present 服务端会清掉。 */
export const updateAttendance = (sessionId: string, studentId: string, input: AttendanceInput) =>
  request<AttendanceRecord>('PUT', `/api/sessions/${sessionId}/attendance/${studentId}`, input);
