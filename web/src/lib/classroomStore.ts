// ---------------------------------------------------------------------------
// 课堂运行时本地状态 (offline-first, decision 3).
//
// The whole lesson runs in browser-local state: scoring / recitation / homework
// / attendance / re-grouping / undo are all pure reducer edits, persisted to
// LocalStorage after every change so a refresh or an offline blip never loses
// the class. Only "结束课堂" ships the accumulated snapshot to the backend once
// (buildCommitPayload → POST /api/classes/:id/sessions).
//
// Scoring stays an event stream — derivations live in lib/session (sScore /
// gScore / stars / warned) and are reused verbatim.
// ---------------------------------------------------------------------------

import type { CommitPayload } from './api';
import type { Homework, Recitation, SEvent, SGroup, SStudent } from './session';
import type { SessionConfig } from './setup';

export interface ClassroomStudent extends SStudent {
  attendance: 'present' | 'absent';
}

/** Open-time grouping snapshot used for the §7.2 default-grouping writeback.
 *  Frozen at boot so mid-class re-grouping (which mutates students[].g) never
 *  rewrites the class default. Absent students keep their default group here. */
export interface DefaultGroup {
  clientId: string;
  name: string;
  emoji: string | null;
  orderIndex: number;
  memberIds: string[];
}

export interface ClassroomSession {
  clientSessionId: string; // idempotency key; stable across retries (decision 10)
  classId: string;
  className?: string;
  lessonNumber?: string; // as typed in 课前配置 (optional)
  lessonTitle?: string;
  teacherId?: string; // 主讲老师 (unset → server falls back to the committing teacher)
  teacherName?: string;
  plannedDurationMin: number;
  startedAt: string; // real wall clock at 开始课堂, 'YYYY-MM-DD HH:mm:ss'
  defaultGrouping: DefaultGroup[];
  groups: SGroup[];
  students: ClassroomStudent[];
  events: SEvent[];
  nid: number; // next local event id
}

// ---- boot -----------------------------------------------------------------

/** Boot a fresh, empty-ledger ClassroomSession from a 课前配置 handoff config. */
export function buildClassroomSession(
  cfg: SessionConfig,
  meta: { classId: string; clientSessionId: string; startedAt: string },
): ClassroomSession {
  const groups: SGroup[] = cfg.groups.map((g) => ({ id: g.id, name: g.name, emoji: g.emoji }));
  const present: ClassroomStudent[] = cfg.students.map((s) => ({
    id: s.id,
    g: s.g,
    name: s.name,
    r: null,
    h: null,
    attendance: 'present',
  }));
  // Pre-class absent students are still registered; they render under their
  // original group as "未到" (or nowhere if ungrouped) and score nothing.
  const absent: ClassroomStudent[] = cfg.absent.map((a) => ({
    id: a.id,
    g: a.originalGroupId ?? '',
    name: a.name,
    r: null,
    h: null,
    attendance: 'absent',
  }));
  const defaultGrouping: DefaultGroup[] = cfg.groups.map((g, i) => ({
    clientId: g.id,
    name: g.name,
    emoji: g.emoji ?? null,
    orderIndex: i,
    memberIds: [
      ...cfg.students.filter((s) => s.g === g.id).map((s) => s.id),
      ...cfg.absent.filter((a) => a.originalGroupId === g.id).map((a) => a.id),
    ],
  }));
  return {
    clientSessionId: meta.clientSessionId,
    classId: meta.classId,
    className: cfg.className,
    lessonNumber: cfg.lessonNumber || undefined,
    lessonTitle: cfg.lessonTitle || undefined,
    teacherId: cfg.teacherId,
    teacherName: cfg.teacherName,
    plannedDurationMin: cfg.durationMin,
    startedAt: meta.startedAt,
    defaultGrouping,
    groups,
    students: [...present, ...absent],
    events: [],
    nid: 1,
  };
}

// ---- reducer --------------------------------------------------------------

export type CAction =
  | { type: 'scoreStudent'; sid: string; d: 1 | -1; at: string }
  | { type: 'scoreGroup'; gid: string; d: 1 | -1; at: string }
  | { type: 'undo' }
  | { type: 'setRecite'; sid: string; v: Recitation }
  | { type: 'setHomework'; sid: string; v: Homework }
  | { type: 'toggleAttendance'; sid: string }
  | { type: 'moveStudent'; sid: string; gid: string }
  | {
      type: 'setLessonInfo';
      lessonNumber: string;
      lessonTitle: string;
      durationMin: number;
      teacherId?: string; // omitted → keep the current 主讲老师
      teacherName?: string;
      startedAt?: string; // omitted → keep the current 开始时间 ('YYYY-MM-DD HH:mm:ss')
    }
  | { type: 'setGroupEmoji'; gid: string; emoji: string }
  | { type: 'renameGroup'; gid: string; name: string }
  | { type: 'removeGroup'; gid: string };

export function reducer(s: ClassroomSession, a: CAction): ClassroomSession {
  switch (a.type) {
    case 'scoreStudent': {
      const st = s.students.find((x) => x.id === a.sid);
      return st ? pushEvent(s, 'student', a.sid, st.g, a.d, a.at) : s;
    }
    case 'scoreGroup':
      return pushEvent(s, 'group', a.gid, a.gid, a.d, a.at);
    case 'undo':
      return s.events.length ? { ...s, events: s.events.slice(0, -1) } : s;
    case 'setRecite':
      return mapStudent(s, a.sid, (x) => ({ ...x, r: a.v }));
    case 'setHomework':
      return mapStudent(s, a.sid, (x) => ({ ...x, h: a.v }));
    case 'toggleAttendance':
      return mapStudent(s, a.sid, (x) => ({ ...x, attendance: x.attendance === 'absent' ? 'present' : 'absent' }));
    case 'moveStudent':
      return mapStudent(s, a.sid, (x) => ({ ...x, g: a.gid }));
    case 'setLessonInfo':
      // Mid-class edit of 本节课 info; blank fields revert to unset, matching
      // buildClassroomSession so the commit payload emits null for them.
      return {
        ...s,
        lessonNumber: a.lessonNumber || undefined,
        lessonTitle: a.lessonTitle || undefined,
        teacherId: a.teacherId ?? s.teacherId,
        teacherName: a.teacherName ?? s.teacherName,
        plannedDurationMin: a.durationMin,
        startedAt: a.startedAt ?? s.startedAt,
      };
    case 'setGroupEmoji':
      // Cosmetic, not membership — unlike re-grouping it also updates the
      // frozen default grouping so the new emoji writes back to the class.
      return {
        ...s,
        groups: s.groups.map((g) => (g.id === a.gid ? { ...g, emoji: a.emoji } : g)),
        defaultGrouping: s.defaultGrouping.map((g) => (g.clientId === a.gid ? { ...g, emoji: a.emoji } : g)),
      };
    case 'renameGroup':
      return {
        ...s,
        groups: s.groups.map((g) => (g.id === a.gid ? { ...g, name: a.name } : g)),
        defaultGrouping: s.defaultGrouping.map((g) => (g.clientId === a.gid ? { ...g, name: a.name } : g)),
      };
    case 'removeGroup':
      // Members (present or absent) become ungrouped; the group leaves both the
      // session snapshot and the default-grouping writeback. The event ledger is
      // untouched — commitSession maps the orphaned clientGroupId to null.
      return {
        ...s,
        groups: s.groups.filter((g) => g.id !== a.gid),
        defaultGrouping: s.defaultGrouping.filter((g) => g.clientId !== a.gid),
        students: s.students.map((x) => (x.g === a.gid ? { ...x, g: '' } : x)),
      };
  }
}

function pushEvent(
  s: ClassroomSession,
  tt: 'student' | 'group',
  tid: string,
  g: string,
  d: 1 | -1,
  createdAt: string,
): ClassroomSession {
  return { ...s, events: [...s.events, { id: s.nid, tt, tid, g, d, createdAt }], nid: s.nid + 1 };
}

function mapStudent(s: ClassroomSession, sid: string, fn: (x: ClassroomStudent) => ClassroomStudent): ClassroomSession {
  return { ...s, students: s.students.map((x) => (x.id === sid ? fn(x) : x)) };
}

// ---- persistence (LocalStorage; swap for IndexedDB here if data grows) -----

type KVStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const KEY = (classId: string) => `nce.classroom.${classId}`;

function defaultStore(): KVStore | null {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

/** Load the persisted in-progress session for a class, or null if absent/corrupt. */
export function loadSession(classId: string, store: KVStore | null = defaultStore()): ClassroomSession | null {
  if (!store) return null;
  const raw = store.getItem(KEY(classId));
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as ClassroomSession;
    // Minimal shape guard: a corrupt entry must not lock the classroom entry
    // (decision 12 — "放弃本节课" is the only other escape hatch).
    if (
      s &&
      s.classId === classId &&
      Array.isArray(s.students) &&
      Array.isArray(s.events) &&
      Array.isArray(s.groups) &&
      Array.isArray(s.defaultGrouping) // guard the §7.2 writeback shape too (M2)
    ) {
      return s;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(s: ClassroomSession, store: KVStore | null = defaultStore()): void {
  if (!store) return;
  try {
    store.setItem(KEY(s.classId), JSON.stringify(s));
  } catch {
    /* quota exceeded / private mode — best-effort persistence */
  }
}

export function clearSession(classId: string, store: KVStore | null = defaultStore()): void {
  if (!store) return;
  try {
    store.removeItem(KEY(classId));
  } catch {
    /* ignore */
  }
}

// ---- commit ---------------------------------------------------------------

/** Assemble the one-shot commit payload from the finished local session. */
export function buildCommitPayload(s: ClassroomSession, endedAt: string): CommitPayload {
  const n = Number(s.lessonNumber);
  const lessonNumber = s.lessonNumber && Number.isFinite(n) ? n : null;
  const sessionGroups = s.groups.map((g, i) => ({
    clientId: g.id,
    name: g.name,
    emoji: g.emoji ?? null,
    orderIndex: i,
  }));
  const memberships = s.students.map((st) => ({
    studentId: st.id,
    clientGroupId: st.attendance === 'absent' ? null : st.g || null, // absent ⇒ null (decision 8)
    attendance: st.attendance,
  }));
  const events = s.events.map((e) => ({
    targetType: e.tt,
    targetId: e.tid,
    clientGroupId: e.g || null,
    delta: e.d,
    createdAt: e.createdAt,
  }));
  const checks: CommitPayload['checks'] = [];
  for (const st of s.students) {
    if (st.r) checks.push({ studentId: st.id, type: 'recitation', status: st.r });
    if (st.h) checks.push({ studentId: st.id, type: 'homework', status: st.h });
  }
  return {
    clientSessionId: s.clientSessionId,
    lessonNumber,
    lessonTitle: s.lessonTitle ?? null,
    teacherId: s.teacherId ?? null,
    plannedDurationMin: s.plannedDurationMin,
    startedAt: s.startedAt,
    endedAt,
    defaultGrouping: { groups: s.defaultGrouping },
    sessionGroups,
    memberships,
    events,
    checks,
  };
}

// ---- time helpers ---------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** Local wall clock as the naive 'YYYY-MM-DD HH:mm:ss' string the server parses. */
export function nowSql(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** The 'HH:MM' slice of a stored startedAt for the dialog's time input
 *  ('' when malformed, so the input just starts blank). */
export function startTimeOf(startedAt: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(startedAt) ? startedAt.slice(11, 16) : '';
}

/** Replace the HH:mm of a 'YYYY-MM-DD HH:mm:ss' startedAt with a dialog-edited
 *  'HH:MM', zeroing seconds. Returns null for an invalid HH:MM so callers keep
 *  the original. A malformed stored startedAt falls back to today's date so
 *  the edit still lands a server-parseable timestamp. */
export function applyStartTime(startedAt: string, hhmm: string): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  const date = /^\d{4}-\d{2}-\d{2} /.test(startedAt) ? startedAt.slice(0, 10) : nowSql().slice(0, 10);
  return `${date} ${m[1]}:${m[2]}:00`;
}

/** A fresh idempotency key for a new session (stable across submit retries). */
export function newClientSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `cs-${nowSql().replace(/\D/g, '')}-${Math.floor(Math.random() * 1e9)}`;
}
