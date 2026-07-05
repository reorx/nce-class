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
import { normalizeTagName, tagKey } from './tags';

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

/** 课堂日志的状态变更条目（背书/作业/出勤）。加减分不在这里——它们由
 *  events 派生进日志，撤销即删事件。仅本地展示，永不进 commit payload。 */
export interface StatusLogEntry {
  id: number; // drawn from the same nid sequence as score events → one total order
  at: string; // 'YYYY-MM-DD HH:mm:ss'
  kind: 'recite' | 'homework' | 'attendance';
  sid: string;
  to: string | null; // new value; null = recite cleared back to 未检查（作业无 null 态，旧存档里才有）
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
  log?: StatusLogEntry[]; // optional (persisted-shape compat): old存档 without it starts empty
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
    h: '没交', // 作业默认「没交」（无未批改态；与 server「缺记录=没交」口径一致）
    tags: [],
    attendance: 'present',
  }));
  // Pre-class absent students are still registered; they render under their
  // original group as "未到" (or nowhere if ungrouped) and score nothing.
  const absent: ClassroomStudent[] = cfg.absent.map((a) => ({
    id: a.id,
    g: a.originalGroupId ?? '',
    name: a.name,
    r: null,
    h: '没交',
    tags: [],
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
    log: [],
    nid: 1,
  };
}

// ---- reducer --------------------------------------------------------------

export type CAction =
  | { type: 'scoreStudent'; sid: string; d: 1 | -1; at: string }
  | { type: 'scoreGroup'; gid: string; d: 1 | -1; at: string }
  | { type: 'undo' }
  | { type: 'undoEvent'; eventId: number }
  | { type: 'setRecite'; sid: string; v: Recitation; at: string }
  | { type: 'setHomework'; sid: string; v: Homework; at: string }
  | { type: 'addTag'; sid: string; tag: string }
  | { type: 'removeTag'; sid: string; tag: string }
  | { type: 'toggleAttendance'; sid: string; at: string }
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
    case 'undoEvent':
      // 任意单条撤销（日志视图）：删除该事件即可 —— 个人分与组分都从同一条
      // 事件派生，天然原子回退，其余事件不受影响。
      return s.events.some((e) => e.id === a.eventId)
        ? { ...s, events: s.events.filter((e) => e.id !== a.eventId) }
        : s;
    case 'setRecite': {
      const st = s.students.find((x) => x.id === a.sid);
      if (!st || st.r === a.v) return s; // 点同一状态 = 纯 no-op，不记日志
      return pushLog(
        mapStudent(s, a.sid, (x) => ({ ...x, r: a.v })),
        'recite',
        a.sid,
        a.v,
        a.at,
      );
    }
    case 'setHomework': {
      const st = s.students.find((x) => x.id === a.sid);
      if (!st || st.h === a.v) return s;
      return pushLog(
        mapStudent(s, a.sid, (x) => ({ ...x, h: a.v })),
        'homework',
        a.sid,
        a.v,
        a.at,
      );
    }
    case 'addTag': {
      // 奖章：直接字段修改（同 r/h），不进 events（不联动加分、不受 undo 影响）。
      // 重复打同一 tag（含大小写/空白变体）= 纯 no-op；`tags ?? []` 兼容旧存档。
      const tag = normalizeTagName(a.tag);
      if (!tag) return s;
      const st = s.students.find((x) => x.id === a.sid);
      if (!st || (st.tags ?? []).some((t) => tagKey(t) === tagKey(tag))) return s;
      return mapStudent(s, a.sid, (x) => ({ ...x, tags: [...(x.tags ?? []), tag] }));
    }
    case 'removeTag': {
      const st = s.students.find((x) => x.id === a.sid);
      if (!st || !(st.tags ?? []).some((t) => tagKey(t) === tagKey(a.tag))) return s;
      return mapStudent(s, a.sid, (x) => ({ ...x, tags: (x.tags ?? []).filter((t) => tagKey(t) !== tagKey(a.tag)) }));
    }
    case 'toggleAttendance': {
      const st = s.students.find((x) => x.id === a.sid);
      if (!st) return s;
      const to = st.attendance === 'absent' ? 'present' : 'absent';
      return pushLog(
        mapStudent(s, a.sid, (x) => ({ ...x, attendance: to })),
        'attendance',
        a.sid,
        to,
        a.at,
      );
    }
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
      // Cosmetic, not membership — sync the emoji into defaultGrouping so it
      // writes back. (Membership itself is recomputed live at commit time via
      // writebackGrouping, so moveStudent doesn't need to touch it here.)
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

function pushLog(
  s: ClassroomSession,
  kind: StatusLogEntry['kind'],
  sid: string,
  to: string | null,
  at: string,
): ClassroomSession {
  // `s.log ?? []`: sessions persisted by older builds have no log field.
  return { ...s, log: [...(s.log ?? []), { id: s.nid, at, kind, sid, to }], nid: s.nid + 1 };
}

// ---- persistence (LocalStorage; swap for IndexedDB here if data grows) -----
//
// ⚠️ PERSISTED-SHAPE COMPAT: a page reload after a web deploy loads NEW code
// with an OLD stored ClassroomSession (a lesson can span a release). So this
// shape evolves protobuf-style: never rename/remove/repurpose a field; new
// fields must be optional and every reader must tolerate their absence
// (precedent: teacherId / startedAt handling). Same creed as CommitPayload.

type KVStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
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
      // 旧存档兼容：未批改（h:null）已并入默认「没交」——归一化后新代码不再见 null。
      return { ...s, students: s.students.map((x) => (x.h == null ? { ...x, h: '没交' } : x)) };
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

// ---- commit backup (failed-submit fallback) --------------------------------
//
// The per-class entry `nce.classroom.<classId>` alone can't protect a FAILED
// commit: starting a new session for the same class overwrites it and the
// failed lesson is silently gone. So every commit attempt first copies the
// exact payload (plus the full session, for manual restore) into
// `nce.classroom.backup.<clientSessionId>` — a key no other session can
// collide with — and clears it only after the server confirms the commit.
// clientSessionId idempotency makes re-POSTing a stored payload safe anytime.

export interface CommitBackup {
  savedAt: string; // wall clock of the backup write ('YYYY-MM-DD HH:mm:ss')
  payload: CommitPayload; // frozen exactly as POSTed → retriable as-is
  session: ClassroomSession; // full local state → can be copied back to nce.classroom.<classId>
}

const BACKUP_PREFIX = 'nce.classroom.backup.';
const BACKUP_CAP = 10; // keep the newest N so quota never creeps up

function backupKeys(store: KVStore): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(BACKUP_PREFIX)) keys.push(k);
  }
  return keys;
}

function parseBackup(raw: string | null): CommitBackup | null {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as CommitBackup;
    return b && b.payload?.clientSessionId && b.session ? b : null;
  } catch {
    return null;
  }
}

/** Write/refresh the backup slot for one session, pruning the oldest beyond the cap. */
export function saveCommitBackup(
  b: { session: ClassroomSession; payload: CommitPayload; savedAt?: string },
  store: KVStore | null = defaultStore(),
): void {
  if (!store) return;
  try {
    const entry: CommitBackup = { savedAt: b.savedAt ?? nowSql(), payload: b.payload, session: b.session };
    store.setItem(BACKUP_PREFIX + b.payload.clientSessionId, JSON.stringify(entry));
    const entries = backupKeys(store).map((k) => ({ k, b: parseBackup(store.getItem(k)) }));
    for (const e of entries) if (!e.b) store.removeItem(e.k); // corrupt JSON is unrecoverable anyway
    const live = entries.filter((e) => e.b).sort((x, y) => y.b!.savedAt.localeCompare(x.b!.savedAt));
    for (const e of live.slice(BACKUP_CAP)) store.removeItem(e.k);
  } catch {
    /* quota exceeded / private mode — the per-class entry still holds the session */
  }
}

/** All backup entries, newest first (corrupt ones skipped). */
export function listCommitBackups(store: KVStore | null = defaultStore()): CommitBackup[] {
  if (!store) return [];
  return backupKeys(store)
    .map((k) => parseBackup(store.getItem(k)))
    .filter((b): b is CommitBackup => b !== null)
    .sort((x, y) => y.savedAt.localeCompare(x.savedAt));
}

/** Drop one session's backup — call ONLY after the server confirmed the commit. */
export function clearCommitBackup(clientSessionId: string, store: KVStore | null = defaultStore()): void {
  if (!store) return;
  try {
    store.removeItem(BACKUP_PREFIX + clientSessionId);
  } catch {
    /* ignore */
  }
}

// ---- commit ---------------------------------------------------------------

/** Assemble the one-shot commit payload from the finished local session. */
/**
 * 默认分组回写（§7.2）= 下课时的最终分组，让课中调组（moveStudent）持久化、下次生效。
 * 组的身份/名称/emoji/顺序沿用 s.defaultGrouping（它已跟踪改名/换 emoji/删组）；
 * 成员从当前 s.students[].g 现算 —— 到课与缺席学生都靠 g 字段保住座位，
 * 缺席学生若未被调组仍留原组（沿用旧行为），任何课中调组都会被带上。
 */
function writebackGrouping(s: ClassroomSession): DefaultGroup[] {
  return s.defaultGrouping.map((g) => ({
    ...g,
    memberIds: s.students.filter((st) => st.g === g.clientId).map((st) => st.id),
  }));
}

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
    // 默认「没交」不发：server 读侧把「缺记录」fallback 成 没交，语义等价且行数不膨胀。
    if (st.h && st.h !== '没交') checks.push({ studentId: st.id, type: 'homework', status: st.h });
  }
  const tags: CommitPayload['tags'] = [];
  for (const st of s.students) for (const tag of st.tags ?? []) tags.push({ studentId: st.id, tag });
  return {
    clientSessionId: s.clientSessionId,
    lessonNumber,
    lessonTitle: s.lessonTitle ?? null,
    teacherId: s.teacherId ?? null,
    plannedDurationMin: s.plannedDurationMin,
    startedAt: s.startedAt,
    endedAt,
    defaultGrouping: { groups: writebackGrouping(s) },
    sessionGroups,
    memberships,
    events,
    checks,
    tags,
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
