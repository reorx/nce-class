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

/** One org-library 奖章 tag (GET /api/tags). */
export interface TagItem {
  id: string;
  name: string;
}

export interface ClassListItem {
  id: string;
  name: string;
  teacherName: string;
  textbook: number | null; // 教材册数 1-4
  studentCount: number;
  roster: string[];
  lastSession: {
    id: string;
    date: string;
    weekday: string;
    relative: string;
    lessonNumber: number | null;
    lessonTitle: string | null;
    startedAt: string | null;
    endedAt: string | null;
  } | null;
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
  teacherId: string | null; // 主讲老师 id — 课堂信息 tab form prefill
  teacherName: string | null; // 主讲老师
  plannedDurationMin: number;
  actualDurationMin: number;
  durationLabel: string;
  startedAt: string | null; // 'YYYY-MM-DD HH:mm:ss'; null on legacy rows
  endedAt: string | null;
  groupCount: number;
  hasHomework: boolean; // 作业已布置 (homework_content non-null)
  attendancePresent: number; // 出勤人数；缺勤 = total - present
  attendanceTotal: number; // 0 when the session has no membership snapshot
}

/** One row of the org-wide 课堂 list (GET /api/sessions): a session plus its owning class. */
export interface SessionListItem extends Session {
  classId: string;
  className: string;
}

/** One student row inside a recap group (v3 战报成员明细); absent on legacy payloads. */
export interface RecapMember {
  name: string;
  attendance: 'present' | 'absent' | 'leave';
  score: number; // 该节个人净分
  recitation: string | null; // '已背完' | '背完部分' | '没背'; null = 未检查
  homework: string | null; // '完成' | '需补' | '没交'; null = 没交 (缺记录)
  warns: number; // 该节被扣分的事件次数
}

export interface RecapGroup {
  name: string;
  emoji: string | null;
  orderIndex: number;
  score: number;
  warns?: number; // 该节整组被扣分的事件次数（不含组员个人扣分）; absent on legacy payloads
  members?: RecapMember[]; // roster order; absent on legacy payloads
}

export interface RecapStar {
  name: string;
  net: number;
  photoUrl?: string | null; // resolved storage URL; absent on legacy payloads
}

/** One student's 奖章 tags in a recap (name-keyed like stars/warned). */
export interface RecapStudentTags {
  name: string;
  tags: string[];
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
  ungrouped?: RecapMember[]; // 无组学生（通常是缺席未拖入组的）; absent on legacy payloads
  stars: RecapStar[];
  warned: { name: string }[];
  studentTags: RecapStudentTags[];
}

// The 课前配置 side rail consumes the same shape as a full recap.
export type LastRecap = Recap;

export interface ClassDetail {
  id: string;
  name: string;
  notes: string | null; // 班级资源 — free-form markdown
  textbook: number | null; // 教材册数 1-4 (structured)
  homeworkTemplate: string | null; // 作业模板 with {lesson_number}/{date}/{class_name} vars
  teacherId: string | null; // 负责老师; null on legacy rows
  teacherName: string;
  studentCount: number;
  groupCount: number;
  sessionCount: number;
  students: Student[];
  groups: Group[];
  sessions: Session[];
  lastRecap: LastRecap | null;
}

/** One student inside a 课堂情况 group card; score is the session net, '—' shown for absentees. */
export interface OverviewMember {
  name: string;
  score: number;
  absent: boolean;
}

export interface OverviewGroup {
  id: string;
  name: string;
  emoji: string | null;
  score: number;
  members: OverviewMember[];
}

/** 课堂情况 overview derived from the session ledger (attendance + group scores + check buckets). */
export interface SessionOverview {
  totalStudents: number;
  present: string[];
  absent: string[];
  classScore: number;
  homework: { done: string[]; redo: string[]; miss: string[] };
  recitation: { full: string[]; part: string[]; none: string[]; unchecked: string[] };
  groups: OverviewGroup[];
}

/** 上节课作业参考 — 同班里当前课之前最近一节已布置作业的课（无则 null）. */
export interface PrevHomework {
  sessionId: string;
  date: string;
  year: string;
  weekday: string;
  lessonNumber: number | null;
  lessonTitle: string | null;
  content: string;
  reviewBook: number | null;
  reviewLesson: number | null;
}

/** Raw id-keyed snapshot of a committed session, for reopening it in the classroom (编辑上课记录).
 *  Unlike recap/overview (name-keyed, aggregated) this keeps student ids and the per-event ledger. */
export interface SessionLedger {
  clientSessionId: string | null;
  sessionGroups: { id: string; name: string; emoji: string | null; orderIndex: number }[];
  memberships: {
    studentId: string;
    name: string;
    sessionGroupId: string | null;
    attendance: 'present' | 'absent' | 'leave';
  }[];
  events: {
    targetType: 'student' | 'group';
    targetId: string; // student id, or session group id for group events
    sessionGroupId: string | null; // group at fire time
    delta: 1 | -1;
    createdAt: string;
  }[];
  checks: { studentId: string; type: 'recitation' | 'homework'; status: string }[];
  tags: { studentId: string; tag: string }[];
}

/** GET /api/sessions/:id — session summary + owning-class context + 作业布置 + embedded recap + 课堂情况 + 编辑 ledger. */
export interface SessionDetail extends Session {
  classId: string;
  className: string;
  classTextbook: number | null;
  homeworkTemplate: string | null;
  homeworkContent: string | null;
  reviewBook: number | null; // 课文复习: 第几册
  reviewLesson: number | null; // 课文复习: 第几课
  prevHomework: PrevHomework | null;
  recap: Recap;
  overview: SessionOverview;
  ledger: SessionLedger;
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
  tags: { studentId: string; tag: string }[]; // 奖章 (server upserts the org library by name)
  // 课堂内提前布置的作业（post-release optional field, 缺省/空白 → 不布置）。
  // 仅创建路径落库；编辑上课记录的 overwrite 忽略它（改作业走详情页 PUT）。
  homeworkContent?: string | null;
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

export const api = {
  me: () => get<Me>('/api/me'),
  login: (username: string, password: string) => req<Me>('POST', '/api/auth/login', { username, password }),
  logout: () => req<{ ok: true }>('POST', '/api/auth/logout'),
  verifyPassword: (password: string) => req<{ ok: true }>('POST', '/api/auth/verify-password', { password }),
  teachers: () => get<TeacherItem[]>('/api/teachers'),
  orgTags: () => get<TagItem[]>('/api/tags'),
  createTeacher: (name: string, username: string, password: string) =>
    req<TeacherItem>('POST', '/api/teachers', { name, username, password }),
  // 改名 + 可选改密（password 省略/留空则不改）；username 不可改。
  updateTeacher: (id: string, p: { name: string; password?: string }) =>
    req<TeacherItem>('PUT', `/api/teachers/${id}`, p),
  classes: () => get<ClassListItem[]>('/api/classes'),
  classDetail: (id: string) => get<ClassDetail>(`/api/classes/${id}`),
  createClass: (p: { name: string; teacherId: string; textbook: number | null }) =>
    req<ClassDetail>('POST', '/api/classes', p),
  updateClassInfo: (classId: string, p: { name: string; teacherId: string; textbook: number | null }) =>
    req<ClassDetail>('PUT', `/api/classes/${classId}`, p),
  addStudent: (classId: string, name: string) => req<Student>('POST', `/api/classes/${classId}/students`, { name }),
  updateStudent: (id: string, name: string) =>
    req<{ id: string; name: string; status: StudentStatus }>('PUT', `/api/students/${id}`, { name }),
  deleteStudent: (id: string) => req<{ ok: true }>('DELETE', `/api/students/${id}`),
  setStudentStatus: (id: string, status: StudentStatus) =>
    req<{ id: string; name: string; status: StudentStatus }>('PUT', `/api/students/${id}/status`, { status }),
  listSessions: () => get<SessionListItem[]>('/api/sessions'),
  deleteSession: (id: string) => req<{ ok: true }>('DELETE', `/api/sessions/${id}`),
  // Partial 课堂信息 update — only keys present in `p` are written server-side.
  updateSessionInfo: (
    id: string,
    p: {
      lessonNumber?: number | null;
      lessonTitle?: string | null;
      teacherId?: string | null;
      startedAt?: string;
      endedAt?: string;
    },
  ) => req<SessionDetail>('PUT', `/api/sessions/${id}`, p),
  saveGrouping: (classId: string, groups: GroupSave[]) =>
    req<ClassDetail>('PUT', `/api/classes/${classId}/groups`, { groups }),
  updateClassNotes: (classId: string, notes: string) =>
    req<ClassDetail>('PUT', `/api/classes/${classId}/notes`, { notes }),
  updateHomeworkTemplate: (classId: string, template: string) =>
    req<ClassDetail>('PUT', `/api/classes/${classId}/homework-template`, { template }),
  sessionDetail: (sessionId: string) => get<SessionDetail>(`/api/sessions/${sessionId}`),
  saveSessionHomework: (
    sessionId: string,
    p: { content: string; reviewBook: number | null; reviewLesson: number | null },
  ) => req<SessionDetail>('PUT', `/api/sessions/${sessionId}/homework`, p),
  getStudentProfile: (studentId: string) => get<StudentProfile>(`/api/students/${studentId}/profile`),
  getJoinRequests: (classId: string) => get<JoinRequestItem[]>(`/api/classes/${classId}/join-requests`),
  commitSession: (classId: string, payload: CommitPayload) =>
    req<CommitResult>('POST', `/api/classes/${classId}/sessions`, payload),
  // 编辑上课记录: re-commit the whole ledger onto an existing session (same payload shape).
  overwriteSession: (sessionId: string, payload: CommitPayload) =>
    req<CommitResult>('PUT', `/api/sessions/${sessionId}/commit`, payload),
  classAttendance: (classId: string) => get<ClassAttendance>(`/api/classes/${classId}/attendance`),
  updateAttendance: (sessionId: string, studentId: string, p: { status: AttendanceStatus; madeUp?: boolean }) =>
    req<AttendanceRecord>('PUT', `/api/sessions/${sessionId}/attendance/${studentId}`, p),
};
