export interface Me {
  id: string;
  name: string;
  username: string;
  role: string;
  orgName: string;
}

export interface TeacherItem {
  id: string;
  name: string;
  username: string;
  role: string;
}

export interface ClassListItem {
  id: string;
  name: string;
  level: string | null;
  teacherName: string;
  studentCount: number;
  roster: string[];
  lastSession: { date: string; weekday: string; relative: string } | null;
}

export type StudentStatus = 'active' | 'suspended' | 'archived';

export interface Student {
  id: string;
  name: string;
  source: 'parent' | 'teacher';
  status: StudentStatus;
  hasPhoto: boolean;
  score: number;
  groupId: string | null;
}

export interface Group {
  id: string;
  name: string;
  emoji: string | null;
  orderIndex: number;
  memberIds: string[];
}

export interface Session {
  id: string;
  date: string;
  year: string;
  weekday: string;
  lessonNumber: number | null;
  lessonTitle: string | null;
  teacherName: string | null; // 主讲老师
  plannedDurationMin: number;
  actualDurationMin: number;
  durationLabel: string;
  startedAt: string | null; // 'YYYY-MM-DD HH:mm:ss'; null on legacy rows
  endedAt: string | null;
  groupCount: number;
}

export interface RecapGroup {
  name: string;
  emoji: string | null;
  orderIndex: number;
  score: number;
}

export interface RecapStar {
  name: string;
  net: number;
}

export interface Recap {
  date: string;
  weekday: string;
  lessonNumber: number | null;
  lessonTitle: string | null;
  actualDurationMin: number;
  attendancePresent: number;
  attendanceTotal: number;
  groups: RecapGroup[];
  stars: RecapStar[];
  warned: { name: string }[];
}

// The 课前配置 side rail consumes the same shape as a full recap.
export type LastRecap = Recap;

export interface ClassDetail {
  id: string;
  name: string;
  level: string | null;
  notes: string | null; // 班级资源 — free-form markdown
  teacherName: string;
  studentCount: number;
  groupCount: number;
  sessionCount: number;
  students: Student[];
  groups: Group[];
  sessions: Session[];
  lastRecap: LastRecap | null;
}

// ---- student growth profile (§7.4, read-only) ------------------------------

/** One matrix cell; null when the student had no membership row (未入班). */
export interface ProfileMine {
  attended: boolean;
  groupName: string | null;
  groupEmoji: string | null;
  groupScore: number | null;
  personalScore: number;
  homework: string; // '完成' | '没交' (missing record = 没交)
  recitation: string; // '已背完' | '背完部分' | '没背' | '未检查' (missing record = 未检查)
}

export interface ProfileSession {
  id: string;
  date: string;
  year: string;
  weekday: string;
  lessonNumber: number | null;
  lessonTitle: string | null;
  mine: ProfileMine | null;
}

export interface StudentProfile {
  student: {
    id: string;
    name: string;
    source: 'parent' | 'teacher';
    status: StudentStatus;
    photoUrl: string | null;
  };
  class: { id: string; name: string };
  currentGroup: { name: string; emoji: string | null } | null;
  totals: { attended: number; personalTotal: number; plus: number; minus: number };
  sessions: ProfileSession[]; // ended sessions, oldest → newest
}

/** A pending miniapp join request (read-only here; handled inside the miniapp). */
export interface JoinRequestItem {
  id: string;
  cnName: string;
  enName: string | null;
  parentPhone: string | null;
  photoUrl: string | null;
  nickname: string | null;
  createdAt: string;
}

/** A group as sent to the default-grouping save endpoint (replace semantics). */
export interface GroupSave {
  id?: string | null;
  name: string;
  emoji: string | null;
  orderIndex: number;
  memberIds: string[];
}

// ---- classroom commit (end-class one-shot POST) ---------------------------

export interface CommitGroup {
  clientId: string;
  name: string;
  emoji: string | null;
  orderIndex: number;
}

/** The whole session, assembled locally and POSTed once when class ends.
 *
 * ⚠️ SCHEMA COMPAT (protobuf-style — do NOT break): a classroom page loaded
 * before a deploy still POSTs this OLD shape to the NEW server, and old
 * localStorage sessions feed buildCommitPayload after a reload. So: never
 * rename/remove/repurpose a field; new fields must be optional server-side
 * with a default (mirror of buildCommitInput's compat note in server/src/app.ts). */
export interface CommitPayload {
  clientSessionId: string; // idempotency key (stable across retries)
  lessonNumber: number | null;
  lessonTitle: string | null;
  teacherId: string | null; // 主讲老师; null → server falls back to the committing teacher
  plannedDurationMin: number;
  startedAt: string; // 'YYYY-MM-DD HH:mm:ss'
  endedAt: string; // 'YYYY-MM-DD HH:mm:ss'
  defaultGrouping: { groups: (CommitGroup & { memberIds: string[] })[] }; // §7.2 writeback
  sessionGroups: CommitGroup[];
  memberships: { studentId: string; clientGroupId: string | null; attendance: 'present' | 'absent' }[];
  events: {
    targetType: 'student' | 'group';
    targetId: string;
    clientGroupId: string | null;
    delta: 1 | -1;
    createdAt: string;
  }[];
  checks: { studentId: string; type: 'recitation' | 'homework'; status: string }[];
}

export interface CommitResult {
  sessionId: string;
  recap: Recap;
  created: boolean; // false when an existing session was returned (idempotent replay)
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status} ${url}`;
    try {
      const j = await res.json();
      if (j?.error) message = j.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const get = <T>(url: string) => req<T>('GET', url);

export const api = {
  me: () => get<Me>('/api/me'),
  login: (username: string, password: string) => req<Me>('POST', '/api/auth/login', { username, password }),
  logout: () => req<{ ok: true }>('POST', '/api/auth/logout'),
  verifyPassword: (password: string) => req<{ ok: true }>('POST', '/api/auth/verify-password', { password }),
  teachers: () => get<TeacherItem[]>('/api/teachers'),
  createTeacher: (name: string, username: string, password: string) =>
    req<TeacherItem>('POST', '/api/teachers', { name, username, password }),
  classes: () => get<ClassListItem[]>('/api/classes'),
  classDetail: (id: string) => get<ClassDetail>(`/api/classes/${id}`),
  createClass: (name: string, level: string | null) => req<ClassDetail>('POST', '/api/classes', { name, level }),
  addStudent: (classId: string, name: string) => req<Student>('POST', `/api/classes/${classId}/students`, { name }),
  deleteStudent: (id: string) => req<{ ok: true }>('DELETE', `/api/students/${id}`),
  setStudentStatus: (id: string, status: StudentStatus) =>
    req<{ id: string; name: string; status: StudentStatus }>('PUT', `/api/students/${id}/status`, { status }),
  deleteSession: (id: string) => req<{ ok: true }>('DELETE', `/api/sessions/${id}`),
  updateSessionStartedAt: (id: string, startedAt: string) =>
    req<{ ok: true }>('PUT', `/api/sessions/${id}`, { startedAt }),
  saveGrouping: (classId: string, groups: GroupSave[]) =>
    req<ClassDetail>('PUT', `/api/classes/${classId}/groups`, { groups }),
  updateClassNotes: (classId: string, notes: string) =>
    req<ClassDetail>('PUT', `/api/classes/${classId}/notes`, { notes }),
  getSessionRecap: (sessionId: string) => get<Recap>(`/api/sessions/${sessionId}/recap`),
  getStudentProfile: (studentId: string) => get<StudentProfile>(`/api/students/${studentId}/profile`),
  getJoinRequests: (classId: string) => get<JoinRequestItem[]>(`/api/classes/${classId}/join-requests`),
  commitSession: (classId: string, payload: CommitPayload) =>
    req<CommitResult>('POST', `/api/classes/${classId}/sessions`, payload),
};
