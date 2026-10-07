import type { BookKey } from '../lib/homework';
import { get, request, type RequestOptions } from './client';

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
  reviewBook: BookKey | null;
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
  classTextbook: BookKey | null;
  homeworkTemplate: string | null;
  homeworkContent: string | null;
  reviewBook: BookKey | null; // 课文复习: 教材
  reviewLesson: number | null; // 课文复习: 第几课（1-based 平铺序号）
  prevHomework: PrevHomework | null;
  recap: Recap;
  overview: SessionOverview;
  ledger: SessionLedger;
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

export interface UpdateSessionInput {
  lessonNumber?: number | null;
  lessonTitle?: string | null;
  teacherId?: string | null;
  startedAt?: string;
  endedAt?: string;
}

export interface SessionHomeworkInput {
  content: string;
  reviewBook: BookKey | null;
  reviewLesson: number | null;
}

export const listSessions = (options?: RequestOptions) => get<SessionListItem[]>('/api/sessions', options);

export const getSession = (sessionId: string, options?: RequestOptions) =>
  get<SessionDetail>(`/api/sessions/${sessionId}`, options);

export const deleteSession = (id: string) => request<{ ok: true }>('DELETE', `/api/sessions/${id}`);

/** Partial 课堂信息 update — only keys present in `input` are written server-side. 返回完整 SessionDetail。 */
export const updateSession = (id: string, input: UpdateSessionInput) =>
  request<SessionDetail>('PUT', `/api/sessions/${id}`, input);

export const updateSessionHomework = (sessionId: string, input: SessionHomeworkInput) =>
  request<SessionDetail>('PUT', `/api/sessions/${sessionId}/homework`, input);

/** 结束课堂一次性提交；clientSessionId 幂等。 */
export const commitSession = (classId: string, payload: CommitPayload) =>
  request<CommitResult>('POST', `/api/classes/${classId}/sessions`, payload);

/** 编辑上课记录: re-commit the whole ledger onto an existing session (same payload shape). */
export const overwriteSession = (sessionId: string, payload: CommitPayload) =>
  request<CommitResult>('PUT', `/api/sessions/${sessionId}/commit`, payload);
