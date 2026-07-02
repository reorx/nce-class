import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { verifyPassword } from './auth/password.js';
import {
  clearSessionCookie,
  parseCookies,
  SESSION_COOKIE,
  sessionCookie,
  signSession,
  verifySession,
} from './auth/session.js';
import { sqlite, DB_PATH } from './db/client.js';
import {
  addStudent,
  commitSession,
  createClass,
  deleteStudent,
  saveGrouping,
  type CommitInput,
  type GroupInput,
} from './db/mutations.js';
import { UPLOAD_DIR } from './storage/local.js';
import { fmtDuration, relativeDayCN, weekdayCN } from './util/time.js';

if (
  !existsSync(DB_PATH) ||
  sqlite.prepare(`SELECT count(*) c FROM sqlite_master WHERE type='table' AND name='classes'`).get() == null
) {
  console.warn('⚠️  Database not initialised. Run: pnpm --filter server db:reset');
}

// ---- prepared queries -----------------------------------------------------
const q = {
  org: sqlite.prepare(`SELECT * FROM organizations LIMIT 1`),
  teacherByUsername: sqlite.prepare(`SELECT * FROM teachers WHERE username=?`),
  credByTeacher: sqlite.prepare(`SELECT * FROM credentials WHERE teacher_id=? AND provider='password'`),
  classes: sqlite.prepare(`SELECT * FROM classes ORDER BY created_at`),
  classById: sqlite.prepare(`SELECT * FROM classes WHERE id=?`),
  teacherById: sqlite.prepare(`SELECT * FROM teachers WHERE id=?`),
  studentCounts: sqlite.prepare(`SELECT class_id, COUNT(*) c FROM students GROUP BY class_id`),
  allStudentsOrdered: sqlite.prepare(`SELECT id, class_id, name FROM students ORDER BY created_at, id`),
  studentById: sqlite.prepare(`SELECT * FROM students WHERE id=?`),
  lastSessions: sqlite.prepare(`SELECT class_id, MAX(date) d FROM class_sessions GROUP BY class_id`),
  studentsOfClass: sqlite.prepare(
    `SELECT id, name, source, photo_url FROM students WHERE class_id=? ORDER BY created_at, id`,
  ),
  scoresOfClass: sqlite.prepare(
    `SELECT s.id sid, COALESCE(SUM(e.delta),0) score
     FROM students s LEFT JOIN score_events e
       ON e.target_type='student' AND e.target_id = s.id
     WHERE s.class_id=? GROUP BY s.id`,
  ),
  groupsOfClass: sqlite.prepare(`SELECT * FROM class_groups WHERE class_id=? ORDER BY order_index`),
  membershipsOfClass: sqlite.prepare(
    `SELECT cgm.class_group_id gid, cgm.student_id sid
     FROM class_group_memberships cgm JOIN class_groups g ON g.id = cgm.class_group_id
     WHERE g.class_id=?`,
  ),
  sessionsOfClass: sqlite.prepare(
    `SELECT * FROM class_sessions WHERE class_id=? ORDER BY date DESC, lesson_number DESC`,
  ),
  sessionById: sqlite.prepare(`SELECT * FROM class_sessions WHERE id=?`),
  sessionByClientId: sqlite.prepare(`SELECT * FROM class_sessions WHERE client_session_id=?`),
  sessionGroupCounts: sqlite.prepare(`SELECT session_id, COUNT(*) c FROM session_groups GROUP BY session_id`),
  lastEndedSession: sqlite.prepare(
    `SELECT * FROM class_sessions WHERE class_id=? AND status='ended'
     ORDER BY date DESC, lesson_number DESC LIMIT 1`,
  ),
  sessionGroups: sqlite.prepare(`SELECT * FROM session_groups WHERE session_id=? ORDER BY order_index`),
  // Per-session-group score (nested, §5): group events on the group + student
  // events tagged with that group at the time they fired.
  sessionGroupScores: sqlite.prepare(
    `SELECT sg.id gid, COALESCE(SUM(e.delta),0) score
     FROM session_groups sg
     LEFT JOIN score_events e
       ON e.session_id = sg.session_id
      AND ((e.target_type='group' AND e.target_id = sg.id)
        OR (e.target_type='student' AND e.session_group_id = sg.id))
     WHERE sg.session_id=? GROUP BY sg.id`,
  ),
  // Per-student net + min delta within a session, for the recap 亮眼 / 被提醒 lists.
  sessionStudentDeltas: sqlite.prepare(
    `SELECT st.id sid, st.name name, st.created_at ca,
       COALESCE(SUM(e.delta),0) net, COALESCE(MIN(e.delta),0) mind
     FROM students st
     JOIN score_events e
       ON e.target_type='student' AND e.target_id = st.id AND e.session_id=?
     GROUP BY st.id ORDER BY st.created_at, st.id`,
  ),
  sessionAttendance: sqlite.prepare(
    `SELECT SUM(CASE WHEN attendance='present' THEN 1 ELSE 0 END) present, COUNT(*) total
     FROM session_memberships WHERE session_id=?`,
  ),
};

const md = (d: string) => d.slice(5); // 'YYYY-MM-DD' -> 'MM-DD'

/** Actual minutes taught = endedAt − startedAt, falling back to the plan. */
function actualMin(s: any): number {
  return s.started_at && s.ended_at
    ? Math.round(
        (Date.parse(s.ended_at.replace(' ', 'T') + 'Z') - Date.parse(s.started_at.replace(' ', 'T') + 'Z')) / 60000,
      )
    : s.planned_duration_min;
}

function classListPayload() {
  const classes = q.classes.all() as any[];
  const counts = new Map((q.studentCounts.all() as any[]).map((r) => [r.class_id, r.c]));
  const last = new Map((q.lastSessions.all() as any[]).map((r) => [r.class_id, r.d]));
  const rosterByClass = new Map<string, string[]>();
  for (const s of q.allStudentsOrdered.all() as any[]) {
    const arr = rosterByClass.get(s.class_id) || [];
    if (arr.length < 6) arr.push(s.name);
    rosterByClass.set(s.class_id, arr);
  }
  return classes.map((c) => {
    const teacher = c.teacher_id ? (q.teacherById.get(c.teacher_id) as any) : null;
    const lastDate = last.get(c.id) as string | undefined;
    return {
      id: c.id,
      name: c.name,
      level: c.level,
      teacherName: teacher?.name ?? '—',
      studentCount: counts.get(c.id) ?? 0,
      roster: rosterByClass.get(c.id) ?? [],
      lastSession: lastDate
        ? { date: md(lastDate), weekday: weekdayCN(lastDate), relative: relativeDayCN(lastDate) }
        : null,
    };
  });
}

function classDetailPayload(id: string) {
  const c = q.classById.get(id) as any;
  if (!c) return null;
  const teacher = c.teacher_id ? (q.teacherById.get(c.teacher_id) as any) : null;
  const scores = new Map((q.scoresOfClass.all(id) as any[]).map((r) => [r.sid, r.score]));
  const groupByStudent = new Map((q.membershipsOfClass.all(id) as any[]).map((r) => [r.sid, r.gid]));
  const students = (q.studentsOfClass.all(id) as any[]).map((s) => ({
    id: s.id,
    name: s.name,
    source: s.source,
    hasPhoto: s.photo_url != null,
    score: scores.get(s.id) ?? 0,
    groupId: groupByStudent.get(s.id) ?? null,
  }));
  const groups = (q.groupsOfClass.all(id) as any[]).map((g) => ({
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    orderIndex: g.order_index,
    memberIds: students.filter((s) => s.groupId === g.id).map((s) => s.id),
  }));
  const sgCounts = new Map((q.sessionGroupCounts.all() as any[]).map((r) => [r.session_id, r.c]));
  const sessions = (q.sessionsOfClass.all(id) as any[]).map((s) => {
    const actual = actualMin(s);
    return {
      id: s.id,
      date: md(s.date),
      year: s.date.slice(0, 4),
      weekday: weekdayCN(s.date),
      lessonNumber: s.lesson_number,
      lessonTitle: s.lesson_title,
      plannedDurationMin: s.planned_duration_min,
      actualDurationMin: actual,
      durationLabel: fmtDuration(actual),
      groupCount: sgCounts.get(s.id) ?? 0,
    };
  });
  return {
    id: c.id,
    name: c.name,
    level: c.level,
    teacherName: teacher?.name ?? '—',
    studentCount: students.length,
    groupCount: groups.length,
    sessionCount: sessions.length,
    inviteLink: id === 'c1' ? 'https://nce.class/join/c1-x8Kq2mLp' : `https://nce.class/join/${id}-${id}Kq2mLp`,
    students,
    groups,
    sessions,
    lastRecap: lastRecapPayload(id),
  };
}

/** Full recap derived from one ended session's ledger (group ranking + 亮眼/被提醒 + 出勤). */
function buildRecap(s: any) {
  const scoreByGid = new Map((q.sessionGroupScores.all(s.id) as any[]).map((r) => [r.gid, r.score]));
  const groups = (q.sessionGroups.all(s.id) as any[])
    .map((g) => ({ name: g.name, emoji: g.emoji, orderIndex: g.order_index, score: scoreByGid.get(g.id) ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const deltas = q.sessionStudentDeltas.all(s.id) as any[];
  const stars = deltas
    .filter((r) => r.net >= 2)
    .sort((a, b) => b.net - a.net)
    .map((r) => ({ name: r.name, net: r.net }));
  const warned = deltas.filter((r) => r.mind < 0).map((r) => ({ name: r.name }));
  const att = q.sessionAttendance.get(s.id) as any;
  return {
    date: md(s.date),
    weekday: weekdayCN(s.date),
    lessonNumber: s.lesson_number,
    lessonTitle: s.lesson_title,
    actualDurationMin: actualMin(s),
    attendancePresent: att?.present ?? 0,
    attendanceTotal: att?.total ?? 0,
    groups,
    stars,
    warned,
  };
}

/** Derived recap of the most recent ended session, for the 课前配置 side rail. */
function lastRecapPayload(classId: string) {
  const s = q.lastEndedSession.get(classId) as any;
  if (!s) return null;
  return buildRecap(s);
}

// ---- request helpers ------------------------------------------------------
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The class row if it exists and belongs to the acting teacher's org, else null. */
function classInOrg(classId: string, orgId: string): any | null {
  const c = q.classById.get(classId) as any;
  return c && c.org_id === orgId ? c : null;
}

// Naive 'YYYY-MM-DD HH:mm:ss' (no T/Z) — actualMin parses it as UTC, so an ISO
// string would compute NaN. The commit contract pins this shape (decision 9).
// Ranges are bounded so a crafted body can't store '2026-13-99 99:99:99'.
const TIME_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

/** Coerce to a non-negative integer, or a fallback when not a finite number. */
const intOr = (v: unknown, fallback: number | null): number | null =>
  Number.isFinite(v) ? Math.trunc(v as number) : fallback;

/**
 * Validate + normalise an end-class commit body into a CommitInput, or return an
 * error message. Enforces: time-string format, delta ∈ {±1}, student/group ids
 * belong to the class, attendance ∈ {present,absent}.
 */
function buildCommitInput(body: any, classId: string, teacherId: string): { input: CommitInput } | { error: string } {
  const clientSessionId = str(body?.clientSessionId);
  if (!clientSessionId) return { error: 'clientSessionId 必填' };
  const startedAt = str(body?.startedAt);
  const endedAt = str(body?.endedAt);
  if (!startedAt || !TIME_RE.test(startedAt)) return { error: 'startedAt 必须是 YYYY-MM-DD HH:mm:ss' };
  if (!endedAt || !TIME_RE.test(endedAt)) return { error: 'endedAt 必须是 YYYY-MM-DD HH:mm:ss' };

  const roster = new Set((q.studentsOfClass.all(classId) as any[]).map((s) => s.id));
  const classGroupIds = new Set((q.groupsOfClass.all(classId) as any[]).map((g) => g.id));
  // A student ref not on the roster is either DELETED (row gone → drop the row,
  // consistent with saveGrouping's filter, so a mid-class deletion can't brick
  // the commit — M4) or FOREIGN (belongs to another class → reject, no leak).
  const classifyStudent = (sid: string): 'own' | 'deleted' | 'foreign' =>
    roster.has(sid) ? 'own' : q.studentById.get(sid) ? 'foreign' : 'deleted';

  const sgRaw = Array.isArray(body?.sessionGroups) ? body.sessionGroups : [];
  const sessionGroups = [];
  const clientGroupIds = new Set<string>();
  for (const g of sgRaw) {
    const clientId = str(g?.clientId);
    const name = str(g?.name);
    if (!clientId || !name) return { error: '每个课堂小组需要 clientId 与 name' };
    clientGroupIds.add(clientId);
    sessionGroups.push({
      clientId,
      name,
      emoji: str(g?.emoji),
      orderIndex: intOr(g?.orderIndex, sessionGroups.length)!,
    });
  }
  const knownGroup = (cid: string | null) => cid == null || clientGroupIds.has(cid);

  // A missing/malformed defaultGrouping must NOT default to [] — commitSession
  // replaces the class default, so [] would silently wipe it (M2).
  if (!Array.isArray(body?.defaultGrouping?.groups)) return { error: 'defaultGrouping.groups 必须是数组' };
  const defaultGrouping: GroupInput[] = [];
  for (const g of body.defaultGrouping.groups) {
    const name = str(g?.name);
    if (!name) return { error: '默认分组的每个小组需要名称' };
    // A non-`new-` id must reference this class's own group; otherwise it would
    // collide (500) or mint an arbitrary class_groups id (M1).
    const gid = str(g?.clientId);
    if (gid && !gid.startsWith('new-') && !classGroupIds.has(gid)) return { error: `未知默认分组 ${gid}` };
    const memberIds = Array.isArray(g?.memberIds) ? g.memberIds.filter((m: unknown) => typeof m === 'string') : [];
    defaultGrouping.push({
      id: gid,
      name,
      emoji: str(g?.emoji),
      orderIndex: intOr(g?.orderIndex, defaultGrouping.length)!,
      memberIds,
    });
  }

  const memRaw = Array.isArray(body?.memberships) ? body.memberships : [];
  const memberships = [];
  for (const m of memRaw) {
    const studentId = str(m?.studentId);
    if (!studentId) return { error: 'membership 需要 studentId' };
    const kind = classifyStudent(studentId);
    if (kind === 'foreign') return { error: `学生 ${studentId} 不属于该班` };
    if (kind === 'deleted') continue; // dropped mid-class → skip (M4)
    const attendance = m?.attendance === 'absent' ? 'absent' : 'present';
    const clientGroupId = str(m?.clientGroupId);
    if (!knownGroup(clientGroupId)) return { error: `未知小组 ${clientGroupId}` };
    memberships.push({ studentId, clientGroupId, attendance });
  }

  const evRaw = Array.isArray(body?.events) ? body.events : [];
  const events = [];
  for (const e of evRaw) {
    const targetType = e?.targetType === 'group' ? 'group' : e?.targetType === 'student' ? 'student' : null;
    if (!targetType) return { error: 'targetType 必须是 student 或 group' };
    const targetId = str(e?.targetId);
    if (!targetId) return { error: 'targetId 必填' };
    if (e?.delta !== 1 && e?.delta !== -1) return { error: 'delta 只能是 +1 或 −1' };
    if (targetType === 'group' && !clientGroupIds.has(targetId)) return { error: `未知小组 ${targetId}` };
    if (targetType === 'student') {
      const kind = classifyStudent(targetId);
      if (kind === 'foreign') return { error: `学生 ${targetId} 不属于该班` };
      if (kind === 'deleted') continue; // dropped mid-class → skip its events (M4)
    }
    const clientGroupId = str(e?.clientGroupId);
    if (!knownGroup(clientGroupId)) return { error: `未知小组 ${clientGroupId}` };
    const createdAt = str(e?.createdAt);
    events.push({ targetType, targetId, clientGroupId, delta: e.delta, createdAt: createdAt ?? startedAt });
  }

  const ckRaw = Array.isArray(body?.checks) ? body.checks : [];
  const checks = [];
  for (const c of ckRaw) {
    const studentId = str(c?.studentId);
    if (!studentId) return { error: 'check 需要 studentId' };
    const kind = classifyStudent(studentId);
    if (kind === 'foreign') return { error: `学生 ${studentId} 不属于该班` };
    if (kind === 'deleted') continue; // dropped mid-class → skip (M4)
    const type = c?.type === 'homework' ? 'homework' : c?.type === 'recitation' ? 'recitation' : null;
    const status = str(c?.status);
    if (!type || !status) return { error: 'check 需要 type 与 status' };
    checks.push({ studentId, type, status });
  }

  return {
    input: {
      classId,
      teacherId,
      clientSessionId,
      date: startedAt.slice(0, 10), // decision 9
      lessonNumber: intOr(body?.lessonNumber, null),
      lessonTitle: str(body?.lessonTitle),
      plannedDurationMin: Math.max(1, intOr(body?.plannedDurationMin, 120)!),
      startedAt,
      endedAt,
      defaultGrouping,
      sessionGroups,
      memberships,
      events,
      checks,
    },
  };
}

// ---- app ------------------------------------------------------------------
export function createApp() {
  const app = express();
  app.use(cors());
  // 1mb headroom: a very event-heavy lesson can exceed express's 100kb default,
  // and a 413 would trap the retry forever (same shape as a dropped commit, L3).
  app.use(express.json({ limit: '1mb' }));
  app.use('/uploads', express.static(UPLOAD_DIR));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // ---- auth ----
  app.post('/api/auth/login', (req, res) => {
    const username = str(req.body?.username);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const teacher = username ? (q.teacherByUsername.get(username) as any) : null;
    const cred = teacher ? (q.credByTeacher.get(teacher.id) as any) : null;
    if (!teacher || !cred?.secret || !verifyPassword(password, cred.secret)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    res.setHeader('Set-Cookie', sessionCookie(signSession(teacher.id, Math.floor(Date.now() / 1000))));
    res.json(mePayload(teacher));
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ ok: true });
  });

  // ---- auth gate: everything under /api except health + login ----
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/auth/login') return next();
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const teacherId = verifySession(token, Math.floor(Date.now() / 1000));
    const teacher = teacherId ? (q.teacherById.get(teacherId) as any) : null;
    if (!teacher) return res.status(401).json({ error: '未登录' });
    res.locals.teacher = teacher;
    next();
  });

  app.get('/api/me', (_req, res) => res.json(mePayload(res.locals.teacher)));

  // ---- classes (read) ----
  app.get('/api/classes', (_req, res) => res.json(classListPayload()));

  app.get('/api/classes/:id', (req, res) => {
    if (!classInOrg(req.params.id, res.locals.teacher.org_id))
      return res.status(404).json({ error: 'class not found' });
    res.json(classDetailPayload(req.params.id));
  });

  // ---- classes (write) ----
  app.post('/api/classes', (req, res) => {
    const teacher = res.locals.teacher;
    const name = str(req.body?.name);
    if (!name) return res.status(400).json({ error: '班级名称必填' });
    const level = str(req.body?.level);
    const id = createClass(sqlite, { orgId: teacher.org_id, name, level, teacherId: teacher.id });
    res.status(201).json(classDetailPayload(id));
  });

  // ---- students (write) ----
  app.post('/api/classes/:id/students', (req, res) => {
    const teacher = res.locals.teacher;
    if (!classInOrg(req.params.id, teacher.org_id)) return res.status(404).json({ error: 'class not found' });
    const name = str(req.body?.name);
    if (!name) return res.status(400).json({ error: '学生姓名必填' });
    const id = addStudent(sqlite, { classId: req.params.id, name });
    const s = q.studentById.get(id) as any;
    res.status(201).json({ id: s.id, name: s.name, source: s.source, hasPhoto: s.photo_url != null, score: 0 });
  });

  app.delete('/api/students/:id', (req, res) => {
    const teacher = res.locals.teacher;
    const s = q.studentById.get(req.params.id) as any;
    if (!s || !classInOrg(s.class_id, teacher.org_id)) return res.status(404).json({ error: 'student not found' });
    deleteStudent(sqlite, req.params.id);
    res.json({ ok: true });
  });

  // ---- default grouping (replace) ----
  app.put('/api/classes/:id/groups', (req, res) => {
    const teacher = res.locals.teacher;
    if (!classInOrg(req.params.id, teacher.org_id)) return res.status(404).json({ error: 'class not found' });
    const raw = req.body?.groups;
    if (!Array.isArray(raw)) return res.status(400).json({ error: 'groups 必须是数组' });
    const roster = new Set((q.studentsOfClass.all(req.params.id) as any[]).map((s) => s.id));
    const groups: GroupInput[] = [];
    for (const g of raw) {
      const name = str(g?.name);
      if (!name) return res.status(400).json({ error: '每个小组需要名称' });
      const memberIds = Array.isArray(g?.memberIds) ? g.memberIds.filter((m: unknown) => typeof m === 'string') : [];
      for (const m of memberIds) {
        if (!roster.has(m)) return res.status(400).json({ error: `学生 ${m} 不属于该班` });
      }
      groups.push({
        id: str(g?.id),
        name,
        emoji: str(g?.emoji),
        orderIndex: Number.isFinite(g?.orderIndex) ? g.orderIndex : groups.length,
        memberIds,
      });
    }
    saveGrouping(sqlite, req.params.id, groups);
    res.json(classDetailPayload(req.params.id));
  });

  // ---- end-class commit (offline-first one-shot; the only session write) ----
  app.post('/api/classes/:id/sessions', (req, res) => {
    const teacher = res.locals.teacher;
    if (!classInOrg(req.params.id, teacher.org_id)) return res.status(404).json({ error: 'class not found' });

    const built = buildCommitInput(req.body, req.params.id, teacher.id);
    if ('error' in built) return res.status(400).json({ error: built.error });

    // Idempotent replay: a retried submit returns the already-stored session.
    // The lookup is global (client_session_id is UNIQUE), so scope it to THIS
    // class — otherwise a colliding id would leak another class/org's recap or
    // report a wrong-class commit as "succeeded" (H1).
    const existing = q.sessionByClientId.get(built.input.clientSessionId) as any;
    if (existing) {
      if (existing.class_id !== req.params.id) return res.status(409).json({ error: 'clientSessionId 已用于其他班级' });
      return res.json({ sessionId: existing.id, recap: buildRecap(existing), created: false });
    }

    const sessionId = commitSession(sqlite, built.input);
    const row = q.sessionById.get(sessionId) as any;
    res.status(201).json({ sessionId, recap: buildRecap(row), created: true });
  });

  // ---- recap (read) ----
  app.get('/api/sessions/:id/recap', (req, res) => {
    const teacher = res.locals.teacher;
    const s = q.sessionById.get(req.params.id) as any;
    if (!s || !classInOrg(s.class_id, teacher.org_id)) return res.status(404).json({ error: 'session not found' });
    res.json(buildRecap(s));
  });

  return app;
}

function mePayload(teacher: any) {
  const org = q.org.get() as any;
  return {
    id: teacher?.id,
    name: teacher?.name,
    username: teacher?.username,
    role: teacher?.role,
    orgName: org?.name,
  };
}
