import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { sqlite, DB_PATH } from './db/client.js';
import { UPLOAD_DIR } from './storage/local.js';
import { fmtDuration, relativeDayCN, weekdayCN } from './util/time.js';

const PORT = Number(process.env.PORT || 5177);

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
  classes: sqlite.prepare(`SELECT * FROM classes ORDER BY created_at`),
  classById: sqlite.prepare(`SELECT * FROM classes WHERE id=?`),
  teacherById: sqlite.prepare(`SELECT * FROM teachers WHERE id=?`),
  studentCounts: sqlite.prepare(`SELECT class_id, COUNT(*) c FROM students GROUP BY class_id`),
  allStudentsOrdered: sqlite.prepare(`SELECT id, class_id, name FROM students ORDER BY created_at, id`),
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

/** Derived recap of the most recent ended session, for the 课前配置 side rail. */
function lastRecapPayload(classId: string) {
  const s = q.lastEndedSession.get(classId) as any;
  if (!s) return null;
  const scoreByGid = new Map((q.sessionGroupScores.all(s.id) as any[]).map((r) => [r.gid, r.score]));
  const groups = (q.sessionGroups.all(s.id) as any[])
    .map((g) => ({ name: g.name, emoji: g.emoji, orderIndex: g.order_index, score: scoreByGid.get(g.id) ?? 0 }))
    .sort((a, b) => b.score - a.score);
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
  };
}

// ---- app ------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/me', (_req, res) => {
  // M1: no login wall on admin pages; the "current teacher" is the org owner.
  const org = q.org.get() as any;
  const teacher = q.teacherByUsername.get('wangli') as any;
  res.json({
    id: teacher?.id,
    name: teacher?.name,
    username: teacher?.username,
    role: teacher?.role,
    orgName: org?.name,
  });
});

app.get('/api/classes', (_req, res) => res.json(classListPayload()));

app.get('/api/classes/:id', (req, res) => {
  const payload = classDetailPayload(req.params.id);
  if (!payload) return res.status(404).json({ error: 'class not found' });
  res.json(payload);
});

app.listen(PORT, () => console.log(`▶ NCE Class API on http://localhost:${PORT}`));
