export interface Me {
  id: string;
  name: string;
  username: string;
  role: string;
  orgName: string;
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

export interface Student {
  id: string;
  name: string;
  source: 'parent' | 'teacher';
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
  plannedDurationMin: number;
  actualDurationMin: number;
  durationLabel: string;
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
  teacherName: string;
  studentCount: number;
  groupCount: number;
  sessionCount: number;
  students: Student[];
  groups: Group[];
  sessions: Session[];
  lastRecap: LastRecap | null;
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

/** The whole session, assembled locally and POSTed once when class ends. */
export interface CommitPayload {
  clientSessionId: string; // idempotency key (stable across retries)
  lessonNumber: number | null;
  lessonTitle: string | null;
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
  classes: () => get<ClassListItem[]>('/api/classes'),
  classDetail: (id: string) => get<ClassDetail>(`/api/classes/${id}`),
  createClass: (name: string, level: string | null) => req<ClassDetail>('POST', '/api/classes', { name, level }),
  addStudent: (classId: string, name: string) => req<Student>('POST', `/api/classes/${classId}/students`, { name }),
  deleteStudent: (id: string) => req<{ ok: true }>('DELETE', `/api/students/${id}`),
  deleteSession: (id: string) => req<{ ok: true }>('DELETE', `/api/sessions/${id}`),
  saveGrouping: (classId: string, groups: GroupSave[]) =>
    req<ClassDetail>('PUT', `/api/classes/${classId}/groups`, { groups }),
  getSessionRecap: (sessionId: string) => get<Recap>(`/api/sessions/${sessionId}/recap`),
  getJoinRequests: (classId: string) => get<JoinRequestItem[]>(`/api/classes/${classId}/join-requests`),
  commitSession: (classId: string, payload: CommitPayload) =>
    req<CommitResult>('POST', `/api/classes/${classId}/sessions`, payload),
};
