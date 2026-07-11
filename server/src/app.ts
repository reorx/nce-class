import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { existsSync } from 'node:fs';
import { verifyPassword } from './auth/password.js';
import {
  clearSessionCookie,
  parseCookies,
  SESSION_COOKIE,
  sessionCookie,
  signSession,
  signWxToken,
  verifySession,
  verifyWxToken,
} from './auth/session.js';
import { code2session } from './auth/wx.js';
import { sqlite, DB_PATH } from './db/client.js';
import {
  addStudent,
  bindTeacherWechat,
  commitSession,
  createClass,
  createInvite,
  createTeacher,
  deleteSession,
  deleteStudent,
  dismissJoinRequest,
  linkJoinRequest,
  overwriteSession,
  renameStudent,
  saveGrouping,
  setAttendance,
  setClassNotes,
  setHomeworkTemplate,
  setSessionHomework,
  setStudentStatus,
  updateClassInfo,
  updateSessionInfo,
  updateTeacher,
  upsertJoinRequest,
  upsertWechatAccount,
  type CommitInput,
  type CommitTag,
  type GroupInput,
} from './db/mutations.js';
import { storageClient } from './storage/index.js';
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
  teachersOfOrg: sqlite.prepare(`SELECT * FROM teachers WHERE org_id=? ORDER BY created_at, rowid`),
  // Head counts everywhere = 在读+停课; archived students don't count (decision 2).
  studentCounts: sqlite.prepare(
    `SELECT class_id, COUNT(*) c FROM students WHERE status != 'archived' GROUP BY class_id`,
  ),
  allStudentsOrdered: sqlite.prepare(
    `SELECT id, class_id, name FROM students WHERE status != 'archived' ORDER BY created_at, id`,
  ),
  studentById: sqlite.prepare(`SELECT * FROM students WHERE id=?`),
  // Latest session per class for the class-list card's mini 上次上课 card
  // (started_at breaks same-day ties; legacy NULL started_at sorts last).
  lastSessionOfClass: sqlite.prepare(
    `SELECT * FROM class_sessions WHERE class_id=?
     ORDER BY date DESC, started_at DESC, lesson_number DESC LIMIT 1`,
  ),
  // Deliberately NOT status-filtered: the detail page shows archived rows, and
  // the commit's classifyStudent must keep suspended/archived students 'own' so
  // a stale local classroom still submits with its snapshot intact.
  studentsOfClass: sqlite.prepare(
    `SELECT id, name, source, status, photo_url FROM students WHERE class_id=? ORDER BY created_at, id`,
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
  // Org-wide 上课记录 (管理页「课堂」). started_at breaks same-day ties across
  // classes; NULL started_at (legacy rows) sorts last within its day.
  sessionsOfOrg: sqlite.prepare(
    `SELECT cs.*, c.name class_name FROM class_sessions cs JOIN classes c ON c.id = cs.class_id
     WHERE c.org_id=? ORDER BY cs.date DESC, cs.started_at DESC, cs.lesson_number DESC`,
  ),
  sessionById: sqlite.prepare(`SELECT * FROM class_sessions WHERE id=?`),
  sessionByClientId: sqlite.prepare(`SELECT * FROM class_sessions WHERE client_session_id=?`),
  sessionGroupCounts: sqlite.prepare(`SELECT session_id, COUNT(*) c FROM session_groups GROUP BY session_id`),
  sessionGroupCountOf: sqlite.prepare(`SELECT COUNT(*) c FROM session_groups WHERE session_id=?`),
  lastEndedSession: sqlite.prepare(
    `SELECT * FROM class_sessions WHERE class_id=? AND status='ended'
     ORDER BY date DESC, lesson_number DESC LIMIT 1`,
  ),
  sessionGroups: sqlite.prepare(`SELECT * FROM session_groups WHERE session_id=? ORDER BY order_index`),
  // Per-session-group score (nested, §5): group events on the group + student
  // events tagged with that group at the time they fired. warns counts only
  // group-target deductions — member deductions surface on the member rows.
  sessionGroupScores: sqlite.prepare(
    `SELECT sg.id gid, COALESCE(SUM(e.delta),0) score,
       COALESCE(SUM(CASE WHEN e.target_type='group' AND e.delta<0 THEN 1 ELSE 0 END),0) warns
     FROM session_groups sg
     LEFT JOIN score_events e
       ON e.session_id = sg.session_id
      AND ((e.target_type='group' AND e.target_id = sg.id)
        OR (e.target_type='student' AND e.session_group_id = sg.id))
     WHERE sg.session_id=? GROUP BY sg.id`,
  ),
  // Per-student net + min delta within a session, for the recap 亮眼 / 被提醒 lists.
  sessionStudentDeltas: sqlite.prepare(
    `SELECT st.id sid, st.name name, st.photo_url, st.created_at ca,
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
  // 课堂情况 overview: per-member roster (with group + attendance), per-student
  // net score, and this session's check records. Rostered by created_at so the
  // attendance/check chip lists read in a stable class order.
  sessionRoster: sqlite.prepare(
    `SELECT sm.student_id sid, sm.session_group_id gid, sm.attendance, st.name
     FROM session_memberships sm JOIN students st ON st.id = sm.student_id
     WHERE sm.session_id=? ORDER BY st.created_at, st.id`,
  ),
  sessionStudentNet: sqlite.prepare(
    `SELECT target_id sid, COALESCE(SUM(delta),0) net,
       COALESCE(SUM(CASE WHEN delta<0 THEN 1 ELSE 0 END),0) warns
     FROM score_events WHERE session_id=? AND target_type='student' GROUP BY target_id`,
  ),
  sessionChecks: sqlite.prepare(`SELECT student_id sid, type, status FROM check_records WHERE session_id=?`),
  // Raw id-keyed ledger for reopening a session in the classroom (编辑上课记录):
  // the per-event stream + per-student tags that the aggregated recap/overview
  // discard. Ordered so the reconstructed local event id sequence is stable.
  sessionEventsRaw: sqlite.prepare(
    `SELECT target_type, target_id, session_group_id, delta, created_at
     FROM score_events WHERE session_id=? ORDER BY created_at, rowid`,
  ),
  sessionTagsRaw: sqlite.prepare(`SELECT student_id, tag_name FROM session_tags WHERE session_id=? ORDER BY rowid`),
  orgById: sqlite.prepare(`SELECT * FROM organizations WHERE id=?`),
  countStudentsOfClass: sqlite.prepare(`SELECT COUNT(*) c FROM students WHERE class_id=? AND status != 'archived'`),
  endedSessionsOfClass: sqlite.prepare(
    `SELECT * FROM class_sessions WHERE class_id=? AND status='ended' ORDER BY date DESC, lesson_number DESC`,
  ),
  membershipOfStudent: sqlite.prepare(`SELECT * FROM session_memberships WHERE session_id=? AND student_id=?`),
  // 考勤 page: ended sessions oldest→newest (columns), non-archived roster
  // (rows), and every membership record of the class in one sweep.
  attendanceSessionsOfClass: sqlite.prepare(
    `SELECT id, date, started_at, lesson_number, lesson_title FROM class_sessions
     WHERE class_id=? AND status='ended' ORDER BY date, started_at, lesson_number`,
  ),
  attendanceStudentsOfClass: sqlite.prepare(
    `SELECT id, name, status FROM students WHERE class_id=? AND status != 'archived' ORDER BY created_at, id`,
  ),
  attendanceRecordsOfClass: sqlite.prepare(
    `SELECT sm.session_id sid, sm.student_id stid, sm.attendance, sm.made_up
     FROM session_memberships sm JOIN class_sessions cs ON cs.id = sm.session_id
     WHERE cs.class_id=? AND cs.status='ended'`,
  ),
  defaultGroupOfStudent: sqlite.prepare(
    `SELECT g.name, g.emoji FROM class_group_memberships m JOIN class_groups g ON g.id=m.class_group_id
     WHERE m.student_id=?`,
  ),
  // 累计口径 (§7.4): student-target events only so group scores never double-count;
  // 加星/扣分 are event COUNTS, not score sums.
  personalTallyOfStudent: sqlite.prepare(
    `SELECT COALESCE(SUM(delta),0) total,
            COALESCE(SUM(CASE WHEN delta=1 THEN 1 ELSE 0 END),0) plus,
            COALESCE(SUM(CASE WHEN delta=-1 THEN 1 ELSE 0 END),0) minus
     FROM score_events WHERE target_type='student' AND target_id=?`,
  ),
  personalScoreOfStudent: sqlite.prepare(
    `SELECT COALESCE(SUM(delta),0) s FROM score_events WHERE session_id=? AND target_type='student' AND target_id=?`,
  ),
  checksOfStudent: sqlite.prepare(`SELECT type, status FROM check_records WHERE session_id=? AND student_id=?`),
  // 奖章 tag library + per-session awards (rowid keeps insertion order — all
  // rows of one commit share the same created_at).
  tagsOfOrg: sqlite.prepare(`SELECT id, name FROM org_tags WHERE org_id=? ORDER BY name COLLATE NOCASE`),
  tagsOfSession: sqlite.prepare(
    `SELECT st.name name, sm.tag_name tag
     FROM session_tags sm JOIN students st ON st.id = sm.student_id
     WHERE sm.session_id=? ORDER BY st.created_at, st.id, sm.rowid`,
  ),
  tagsOfStudentSession: sqlite.prepare(
    `SELECT tag_name FROM session_tags WHERE session_id=? AND student_id=? ORDER BY rowid`,
  ),
  // wx (miniapp) session + invite/queue flows
  wxAccountById: sqlite.prepare(`SELECT * FROM wechat_accounts WHERE id=?`),
  wxTeacherOfAccount: sqlite.prepare(
    `SELECT t.* FROM credentials c JOIN teachers t ON t.id=c.teacher_id
     WHERE c.wechat_account_id=? AND c.provider='wechat'`,
  ),
  wxCredOfTeacher: sqlite.prepare(`SELECT * FROM credentials WHERE teacher_id=? AND provider='wechat'`),
  childrenOfAccount: sqlite.prepare(
    `SELECT s.id sid, s.name, s.photo_url, c.id cid, c.name cname
     FROM student_wechat_bindings b
     JOIN students s ON s.id=b.student_id JOIN classes c ON c.id=s.class_id
     WHERE b.wechat_account_id=? ORDER BY b.created_at, b.id`,
  ),
  pendingOfAccount: sqlite.prepare(
    `SELECT jr.id, jr.class_id cid, c.name cname, jr.cn_name
     FROM join_requests jr JOIN classes c ON c.id=jr.class_id
     WHERE jr.wechat_account_id=? AND jr.status='pending' ORDER BY jr.created_at`,
  ),
  inviteByToken: sqlite.prepare(`SELECT * FROM class_invites WHERE token=? AND expires_at > datetime('now')`),
  classesOfOrg: sqlite.prepare(`SELECT * FROM classes WHERE org_id=? ORDER BY created_at`),
  pendingCountsByClass: sqlite.prepare(
    `SELECT class_id, COUNT(*) c FROM join_requests WHERE status='pending' GROUP BY class_id`,
  ),
  pendingRequestsOfClass: sqlite.prepare(
    `SELECT jr.*, wa.nickname FROM join_requests jr
     JOIN wechat_accounts wa ON wa.id=jr.wechat_account_id
     WHERE jr.class_id=? AND jr.status='pending' ORDER BY jr.created_at`,
  ),
  joinRequestById: sqlite.prepare(`SELECT * FROM join_requests WHERE id=?`),
  bindingOf: sqlite.prepare(`SELECT * FROM student_wechat_bindings WHERE student_id=? AND wechat_account_id=?`),
  studentsWithLinkFlag: sqlite.prepare(
    `SELECT s.id, s.name, s.en_name, s.photo_url, COUNT(b.id) links
     FROM students s LEFT JOIN student_wechat_bindings b ON b.student_id=s.id
     WHERE s.class_id=? AND s.status != 'archived' GROUP BY s.id ORDER BY s.created_at, s.id`,
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
  const rosterByClass = new Map<string, string[]>();
  for (const s of q.allStudentsOrdered.all() as any[]) {
    const arr = rosterByClass.get(s.class_id) || [];
    if (arr.length < 6) arr.push(s.name);
    rosterByClass.set(s.class_id, arr);
  }
  return classes.map((c) => {
    const teacher = c.teacher_id ? (q.teacherById.get(c.teacher_id) as any) : null;
    const ls = q.lastSessionOfClass.get(c.id) as any;
    return {
      id: c.id,
      name: c.name,
      teacherName: teacher?.name ?? '—',
      textbook: c.textbook ?? null,
      studentCount: counts.get(c.id) ?? 0,
      roster: rosterByClass.get(c.id) ?? [],
      lastSession: ls
        ? {
            id: ls.id,
            date: md(ls.date),
            weekday: weekdayCN(ls.date),
            relative: relativeDayCN(ls.date),
            lessonNumber: ls.lesson_number ?? null,
            lessonTitle: ls.lesson_title ?? null,
            startedAt: ls.started_at ?? null,
            endedAt: ls.ended_at ?? null,
          }
        : null,
    };
  });
}

/** One 上课记录 row (shared by classDetailPayload's list and the session detail). */
function sessionSummary(s: any, groupCount: number) {
  const actual = actualMin(s);
  const att = q.sessionAttendance.get(s.id) as any;
  return {
    id: s.id,
    date: md(s.date),
    year: s.date.slice(0, 4),
    weekday: weekdayCN(s.date),
    lessonNumber: s.lesson_number,
    lessonTitle: s.lesson_title,
    teacherId: s.teacher_id ?? null, // 主讲老师 — form prefill on the 课堂信息 tab
    teacherName: (s.teacher_id ? (q.teacherById.get(s.teacher_id) as any)?.name : null) ?? null,
    plannedDurationMin: s.planned_duration_min,
    actualDurationMin: actual,
    durationLabel: fmtDuration(actual),
    startedAt: s.started_at ?? null,
    endedAt: s.ended_at ?? null,
    groupCount,
    hasHomework: s.homework_content != null,
    attendancePresent: att?.present ?? 0, // SUM is NULL when no memberships
    attendanceTotal: att?.total ?? 0,
  };
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
    status: s.status,
    hasPhoto: s.photo_url != null,
    score: scores.get(s.id) ?? 0,
    groupId: groupByStudent.get(s.id) ?? null,
  }));
  const groups = (q.groupsOfClass.all(id) as any[]).map((g) => ({
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    orderIndex: g.order_index,
    // defensive: setStudentStatus already clears memberships for non-active
    memberIds: students.filter((s) => s.groupId === g.id && s.status === 'active').map((s) => s.id),
  }));
  const sgCounts = new Map((q.sessionGroupCounts.all() as any[]).map((r) => [r.session_id, r.c]));
  const sessions = (q.sessionsOfClass.all(id) as any[]).map((s) => sessionSummary(s, sgCounts.get(s.id) ?? 0));
  return {
    id: c.id,
    name: c.name,
    notes: c.notes ?? null,
    textbook: c.textbook ?? null,
    homeworkTemplate: c.homework_template ?? null,
    teacherId: c.teacher_id ?? null,
    teacherName: teacher?.name ?? '—',
    studentCount: students.filter((s) => s.status !== 'archived').length,
    groupCount: groups.length,
    sessionCount: sessions.length,
    students,
    groups,
    sessions,
    lastRecap: lastRecapPayload(id),
  };
}

/** Full recap derived from one ended session's ledger (group ranking + 亮眼/被提醒 + 出勤 + 成员明细). */
function buildRecap(s: any) {
  const scoreRowByGid = new Map((q.sessionGroupScores.all(s.id) as any[]).map((r) => [r.gid, r]));
  // Per-member rows (roster order; missing check record = null, read side maps
  // to 没交/未检查 per PRD §8). warns = 该节被扣分的事件次数.
  const roster = q.sessionRoster.all(s.id) as any[];
  const netByStudent = new Map((q.sessionStudentNet.all(s.id) as any[]).map((r) => [r.sid, r]));
  const checkByStudent = new Map<string, { homework?: string; recitation?: string }>();
  for (const r of q.sessionChecks.all(s.id) as any[]) {
    const rec = checkByStudent.get(r.sid) ?? {};
    rec[r.type as 'homework' | 'recitation'] = r.status;
    checkByStudent.set(r.sid, rec);
  }
  const memberOf = (m: any) => {
    const net = netByStudent.get(m.sid);
    const ck = checkByStudent.get(m.sid) ?? {};
    return {
      name: m.name,
      attendance: m.attendance,
      score: net?.net ?? 0,
      recitation: ck.recitation ?? null,
      homework: ck.homework ?? null,
      warns: net?.warns ?? 0,
    };
  };
  const groups = (q.sessionGroups.all(s.id) as any[])
    .map((g) => ({
      id: g.id,
      name: g.name,
      emoji: g.emoji,
      orderIndex: g.order_index,
      score: scoreRowByGid.get(g.id)?.score ?? 0,
      warns: scoreRowByGid.get(g.id)?.warns ?? 0,
      members: roster.filter((m) => m.gid === g.id).map(memberOf),
    }))
    .sort((a, b) => b.score - a.score);
  const ungrouped = roster.filter((m) => m.gid == null).map(memberOf);
  const deltas = q.sessionStudentDeltas.all(s.id) as any[];
  const stars = deltas
    .filter((r) => r.net >= 2)
    .sort((a, b) => b.net - a.net)
    .map((r) => ({ name: r.name, net: r.net, photoUrl: r.photo_url ? storageClient.getUrl(r.photo_url) : null }));
  const warned = deltas.filter((r) => r.mind < 0).map((r) => ({ name: r.name }));
  const att = q.sessionAttendance.get(s.id) as any;
  // 奖章, grouped per student (name-keyed like stars/warned — the class-level
  // view tolerates the duplicate-name simplification; wx personal views query
  // by student_id instead).
  const tagsByName = new Map<string, string[]>();
  for (const r of q.tagsOfSession.all(s.id) as any[]) {
    const arr = tagsByName.get(r.name) ?? [];
    arr.push(r.tag);
    tagsByName.set(r.name, arr);
  }
  const studentTags = [...tagsByName].map(([name, tags]) => ({ name, tags }));
  return {
    date: md(s.date),
    weekday: weekdayCN(s.date),
    lessonNumber: s.lesson_number,
    lessonTitle: s.lesson_title,
    actualDurationMin: actualMin(s),
    attendancePresent: att?.present ?? 0,
    attendanceTotal: att?.total ?? 0,
    groups,
    ungrouped,
    stars,
    warned,
    studentTags,
  };
}

/**
 * 课堂情况 overview derived from one ended session's ledger: attendance split,
 * per-group member scores (ranked by group score), and homework/背书 check
 * buckets. Absent students still appear inside their group card (score '—') but
 * are excluded from the check buckets — 缺勤学生不计入检查. Check semantics mirror
 * the classroom / wx read side: missing homework record = 没交, missing
 * recitation record = 未检查 (PRD §8). Attendance is present|absent only; there
 * is no 请假 state in the model.
 */
function buildOverview(s: any) {
  const roster = q.sessionRoster.all(s.id) as any[];
  const netByStudent = new Map((q.sessionStudentNet.all(s.id) as any[]).map((r) => [r.sid, r.net]));
  const checkByStudent = new Map<string, { homework?: string; recitation?: string }>();
  for (const r of q.sessionChecks.all(s.id) as any[]) {
    const rec = checkByStudent.get(r.sid) ?? {};
    rec[r.type as 'homework' | 'recitation'] = r.status;
    checkByStudent.set(r.sid, rec);
  }
  const scoreByGid = new Map((q.sessionGroupScores.all(s.id) as any[]).map((r) => [r.gid, r.score]));

  const present = roster.filter((m) => m.attendance === 'present');
  const absent = roster.filter((m) => m.attendance !== 'present');

  const homework = { done: [] as string[], redo: [] as string[], miss: [] as string[] };
  const recitation = { full: [] as string[], part: [] as string[], none: [] as string[], unchecked: [] as string[] };
  for (const m of present) {
    const ck = checkByStudent.get(m.sid) ?? {};
    const h = ck.homework ?? '没交';
    (h === '完成' ? homework.done : h === '需补' ? homework.redo : homework.miss).push(m.name);
    const r = ck.recitation ?? null;
    (r === '已背完'
      ? recitation.full
      : r === '背完部分'
        ? recitation.part
        : r === '没背'
          ? recitation.none
          : recitation.unchecked
    ).push(m.name);
  }

  const groups = (q.sessionGroups.all(s.id) as any[])
    .map((g) => ({
      id: g.id,
      name: g.name,
      emoji: g.emoji,
      score: scoreByGid.get(g.id) ?? 0,
      members: roster
        .filter((m) => m.gid === g.id)
        .map((m) => ({ name: m.name, score: netByStudent.get(m.sid) ?? 0, absent: m.attendance !== 'present' })),
    }))
    .sort((a, b) => b.score - a.score);

  return {
    totalStudents: roster.length,
    present: present.map((m) => m.name),
    absent: absent.map((m) => m.name),
    classScore: groups.reduce((acc, g) => acc + g.score, 0),
    homework,
    recitation,
    groups,
  };
}

/** 上节课作业参考：同班里排在当前课之前（按上课记录次序）、最近一节已布置作业的课。 */
function prevHomeworkPayload(s: any, classId: string) {
  const list = q.sessionsOfClass.all(classId) as any[]; // date DESC, lesson_number DESC
  const idx = list.findIndex((r) => r.id === s.id);
  const prev = idx < 0 ? null : (list.slice(idx + 1).find((r) => r.homework_content != null) ?? null);
  if (!prev) return null;
  return {
    sessionId: prev.id,
    date: md(prev.date),
    year: prev.date.slice(0, 4),
    weekday: weekdayCN(prev.date),
    lessonNumber: prev.lesson_number,
    lessonTitle: prev.lesson_title,
    content: prev.homework_content,
    reviewBook: prev.review_book ?? null,
    reviewLesson: prev.review_lesson ?? null,
  };
}

/**
 * Raw id-keyed snapshot of a committed session, for reopening it in the
 * classroom (编辑上课记录). Unlike recap/overview this keeps student ids and the
 * per-event ledger so the web can rebuild the exact local ClassroomSession.
 */
function sessionLedger(s: any) {
  return {
    clientSessionId: s.client_session_id ?? null,
    sessionGroups: (q.sessionGroups.all(s.id) as any[]).map((g) => ({
      id: g.id,
      name: g.name,
      emoji: g.emoji ?? null,
      orderIndex: g.order_index,
    })),
    memberships: (q.sessionRoster.all(s.id) as any[]).map((m) => ({
      studentId: m.sid,
      name: m.name,
      sessionGroupId: m.gid ?? null,
      attendance: m.attendance,
    })),
    events: (q.sessionEventsRaw.all(s.id) as any[]).map((e) => ({
      targetType: e.target_type,
      targetId: e.target_id,
      sessionGroupId: e.session_group_id ?? null,
      delta: e.delta,
      createdAt: e.created_at,
    })),
    checks: (q.sessionChecks.all(s.id) as any[]).map((c) => ({ studentId: c.sid, type: c.type, status: c.status })),
    tags: (q.sessionTagsRaw.all(s.id) as any[]).map((t) => ({ studentId: t.student_id, tag: t.tag_name })),
  };
}

/** Session detail page payload: summary + owning-class context + 作业布置 + embedded recap + 课堂情况 + 编辑 ledger. */
function sessionDetailPayload(s: any, c: any) {
  return {
    ...sessionSummary(s, (q.sessionGroupCountOf.get(s.id) as any).c),
    classId: c.id,
    className: c.name,
    classTextbook: c.textbook ?? null,
    homeworkTemplate: c.homework_template ?? null,
    homeworkContent: s.homework_content ?? null,
    reviewBook: s.review_book ?? null,
    reviewLesson: s.review_lesson ?? null,
    prevHomework: prevHomeworkPayload(s, c.id),
    recap: buildRecap(s),
    overview: buildOverview(s),
    ledger: sessionLedger(s),
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

/** 作业内容归一：空/纯空白 → null，否则原样保留（内部换行/首尾空白是排版）。
 *  PUT /sessions/:id/homework 与 buildCommitInput 共用，两条写入路径判空口径一致。 */
const contentOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** The class row if it exists and belongs to the acting teacher's org, else null. */
function classInOrg(classId: string, orgId: string): any | null {
  const c = q.classById.get(classId) as any;
  return c && c.org_id === orgId ? c : null;
}

// Naive 'YYYY-MM-DD HH:mm:ss' (no T/Z) — actualMin parses it as UTC, so an ISO
// string would compute NaN. The commit contract pins this shape (decision 9).
// Ranges are bounded so a crafted body can't store '2026-13-99 99:99:99'.
const TIME_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

// 奖章 tag name cap — mirrored by the web picker's maxLength.
const MAX_TAG_LEN = 20;

// 教材册数 → 每册课数（课文复习校验）。镜像 web/src/lib/homework.ts —— 改一处都要改两处。
const BOOK_LESSON_COUNTS: Record<number, number> = { 1: 144, 2: 96, 3: 60, 4: 48 };

/** Parse an optional 册数 body value: absent/null → null, 1-4 int → itself, else 'invalid'. */
const bookOr = (v: unknown): number | null | 'invalid' =>
  v == null ? null : Number.isInteger(v) && BOOK_LESSON_COUNTS[v as number] ? (v as number) : 'invalid';

/** Coerce to a non-negative integer, or a fallback when not a finite number. */
const intOr = (v: unknown, fallback: number | null): number | null =>
  Number.isFinite(v) ? Math.trunc(v as number) : fallback;

/**
 * Validate + normalise an end-class commit body into a CommitInput, or return an
 * error message. Enforces: time-string format, delta ∈ {±1}, student/group ids
 * belong to the class, attendance ∈ {present,absent}. The optional teacherId
 * (主讲老师, picked in 课前配置/课堂信息) must be a same-org teacher; absent →
 * the committing teacher.
 *
 * ⚠️ SCHEMA COMPAT (protobuf-style — do NOT break):
 * an in-progress classroom can outlive a deploy, so a NEWER server must accept
 * the OLD page's payload; a rejected commit here strands a whole lesson's data.
 * When evolving this contract:
 *   - NEVER add a required field — new fields must be optional with a default
 *     (precedents: teacherId → committing teacher, createdAt → startedAt);
 *   - NEVER tighten validation of, rename, or repurpose an existing field;
 *   - unknown fields stay silently ignored (fields are picked explicitly —
 *     keep it that way; no schema-strict body validation here).
 * Guarded by the 向后/向前兼容 tests in tests/api.test.ts — if one fails,
 * fix the contract change, not the test.
 *
 * Validation strictness is two-tier by design: the structural fields above
 * (memberships/events/checks) hard-400 on foreign ids because an error there
 * means a client bug worth surfacing. Decorative post-release fields (tags/
 * 奖章) instead salvage-or-drop each entry — a single dirty cosmetic row must
 * never strand a whole lesson's scores. Follow the lenient tier for future
 * cosmetic additions; do NOT "align" it with the strict tier.
 */
function buildCommitInput(body: any, classId: string, teacher: any): { input: CommitInput } | { error: string } {
  const clientSessionId = str(body?.clientSessionId);
  if (!clientSessionId) return { error: 'clientSessionId 必填' };
  let teacherId = teacher.id;
  const chosen = str(body?.teacherId);
  if (chosen) {
    const t = q.teacherById.get(chosen) as any;
    if (!t || t.org_id !== teacher.org_id) return { error: '主讲老师不存在或不属于本校' };
    teacherId = t.id;
  }
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

  // 奖章 tags — lenient tier (see the compat note): normalise, dedupe per
  // student (case-insensitive), drop what can't be salvaged, never 400.
  const tagRaw = Array.isArray(body?.tags) ? body.tags : [];
  const tags: CommitTag[] = [];
  const seenTags = new Set<string>();
  for (const t of tagRaw) {
    const studentId = str(t?.studentId);
    if (!studentId || classifyStudent(studentId) !== 'own') continue;
    // Mirrors web lib/tags.ts normalizeTagName: collapse whitespace, cut by
    // code point (never mid-emoji), re-trim (the cut can expose a trailing space).
    const collapsed = str(t?.tag)?.replace(/\s+/g, ' ');
    const tag = collapsed ? [...collapsed].slice(0, MAX_TAG_LEN).join('').trim() : null;
    if (!tag) continue;
    const key = `${studentId}\0${tag.toLowerCase()}`;
    if (seenTags.has(key)) continue;
    seenTags.add(key);
    tags.push({ studentId, tag });
  }

  return {
    input: {
      classId,
      teacherId,
      orgId: teacher.org_id,
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
      tags,
      // 课堂内提前布置的作业（lenient tier: optional, absent/blank → null = 不布置）。
      // 仅创建路径落库；overwriteSession 结构性忽略（编辑作业只走详情页 PUT）。
      homeworkContent: contentOrNull(body?.homeworkContent),
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

  // ---- wx (miniapp) API ----------------------------------------------------
  // Bearer token instead of cookies. The gate is three-way: /api/wx/login is
  // public, the rest of /api/wx/* needs a wx token (subject = wechatAccountId),
  // everything else keeps the teacher cookie session below.

  const nowSec = () => Math.floor(Date.now() / 1000);

  const classPreview = (c: any) => {
    const teacher = c.teacher_id ? (q.teacherById.get(c.teacher_id) as any) : null;
    const org = q.orgById.get(c.org_id) as any;
    return {
      className: c.name,
      teacherName: teacher?.name ?? '—',
      orgName: org?.name ?? '',
      studentCount: (q.countStudentsOfClass.get(c.id) as any)?.c ?? 0,
    };
  };

  // me = 身份 + 两侧关联：teacher 来自 provider='wechat' credential，children
  // 来自 bindings，pending 是仍在队列里的注册（index 页按此分流）。
  const wxMePayload = (accountId: string) => {
    const account = q.wxAccountById.get(accountId) as any;
    const teacher = (q.wxTeacherOfAccount.get(accountId) as any) ?? null;
    return {
      account: { id: account.id, nickname: account.nickname, avatarUrl: account.avatar_url },
      teacher: teacher
        ? {
            id: teacher.id,
            name: teacher.name,
            username: teacher.username,
            orgName: (q.orgById.get(teacher.org_id) as any)?.name ?? '',
          }
        : null,
      children: (q.childrenOfAccount.all(accountId) as any[]).map((r) => ({
        studentId: r.sid,
        name: r.name,
        photoUrl: r.photo_url ? storageClient.getUrl(r.photo_url) : null,
        classId: r.cid,
        className: r.cname,
      })),
      pending: (q.pendingOfAccount.all(accountId) as any[]).map((r) => ({
        id: r.id,
        classId: r.cid,
        className: r.cname,
        cnName: r.cn_name,
      })),
    };
  };

  app.post('/api/wx/login', async (req, res) => {
    const code = str(req.body?.code);
    const ident = code ? await code2session(code) : null;
    if (!ident) return res.status(401).json({ error: '微信登录失败' });
    const accountId = upsertWechatAccount(sqlite, ident);
    res.json({ token: signWxToken(accountId, nowSec()), me: wxMePayload(accountId) });
  });

  app.use('/api/wx', (req, res, next) => {
    const h = req.headers.authorization;
    const accountId = verifyWxToken(h?.startsWith('Bearer ') ? h.slice(7) : undefined, nowSec());
    const account = accountId ? (q.wxAccountById.get(accountId) as any) : null;
    if (!account) return res.status(401).json({ error: '未登录' });
    res.locals.wxAccount = account;
    next();
  });

  app.get('/api/wx/me', (_req, res) => res.json(wxMePayload(res.locals.wxAccount.id)));

  app.post('/api/wx/bind-teacher', (req, res) => {
    const account = res.locals.wxAccount;
    const username = str(req.body?.username);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const teacher = username ? (q.teacherByUsername.get(username) as any) : null;
    const cred = teacher ? (q.credByTeacher.get(teacher.id) as any) : null;
    if (!teacher || !cred?.secret || !verifyPassword(password, cred.secret)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    if (q.wxTeacherOfAccount.get(account.id)) return res.status(409).json({ error: '该微信已绑定过老师' });
    if (q.wxCredOfTeacher.get(teacher.id)) return res.status(409).json({ error: '该老师已被其他微信绑定' });
    bindTeacherWechat(sqlite, { teacherId: teacher.id, wechatAccountId: account.id });
    res.json(wxMePayload(account.id));
  });

  // ---- wx teacher side (wx session bound to a teacher; orgId from teacher) --
  const wxTeacherOf = (res: express.Response): any | null =>
    (q.wxTeacherOfAccount.get(res.locals.wxAccount.id) as any) ?? null;

  app.get('/api/wx/teacher/classes', (_req, res) => {
    const teacher = wxTeacherOf(res);
    if (!teacher) return res.status(403).json({ error: '未绑定老师账号' });
    const counts = new Map((q.studentCounts.all() as any[]).map((r) => [r.class_id, r.c]));
    const pending = new Map((q.pendingCountsByClass.all() as any[]).map((r) => [r.class_id, r.c]));
    res.json(
      (q.classesOfOrg.all(teacher.org_id) as any[]).map((c) => ({
        id: c.id,
        name: c.name,
        studentCount: counts.get(c.id) ?? 0,
        pendingCount: pending.get(c.id) ?? 0,
      })),
    );
  });

  // 老师端「上课记录」：org 级全部课堂 brief（导航中枢入口；课后处理/recap 分享后续挂在行上）
  app.get('/api/wx/teacher/sessions', (_req, res) => {
    const teacher = wxTeacherOf(res);
    if (!teacher) return res.status(403).json({ error: '未绑定老师账号' });
    const sgCounts = new Map((q.sessionGroupCounts.all() as any[]).map((r) => [r.session_id, r.c]));
    res.json(
      (q.sessionsOfOrg.all(teacher.org_id) as any[]).map((s) => ({
        ...sessionSummary(s, sgCounts.get(s.id) ?? 0),
        classId: s.class_id,
        className: s.class_name,
      })),
    );
  });

  app.post('/api/wx/teacher/classes/:id/invites', (req, res) => {
    const teacher = wxTeacherOf(res);
    if (!teacher) return res.status(403).json({ error: '未绑定老师账号' });
    if (!classInOrg(req.params.id, teacher.org_id)) return res.status(404).json({ error: 'class not found' });
    const inv = createInvite(sqlite, { classId: req.params.id, teacherId: teacher.id });
    res.status(201).json({
      token: inv.token,
      expiresAt: inv.expiresAt,
      sharePath: `pages/join/index?invite=${inv.token}`,
    });
  });

  const joinRequestItem = (r: any) => ({
    id: r.id,
    cnName: r.cn_name,
    enName: r.en_name,
    parentPhone: r.parent_phone,
    photoUrl: r.photo_key ? storageClient.getUrl(r.photo_key) : null,
    nickname: r.nickname,
    createdAt: r.created_at,
  });

  app.get('/api/wx/teacher/classes/:id/join-requests', (req, res) => {
    const teacher = wxTeacherOf(res);
    if (!teacher) return res.status(403).json({ error: '未绑定老师账号' });
    if (!classInOrg(req.params.id, teacher.org_id)) return res.status(404).json({ error: 'class not found' });
    res.json((q.pendingRequestsOfClass.all(req.params.id) as any[]).map(joinRequestItem));
  });

  app.get('/api/wx/teacher/classes/:id/students', (req, res) => {
    const teacher = wxTeacherOf(res);
    if (!teacher) return res.status(403).json({ error: '未绑定老师账号' });
    if (!classInOrg(req.params.id, teacher.org_id)) return res.status(404).json({ error: 'class not found' });
    res.json(
      (q.studentsWithLinkFlag.all(req.params.id) as any[]).map((s) => ({
        id: s.id,
        name: s.name,
        enName: s.en_name,
        hasPhoto: s.photo_url != null,
        linked: s.links > 0,
      })),
    );
  });

  /** The join_request row if it's pending and its class is in the teacher's org. */
  const pendingRequestFor = (requestId: string, orgId: string): any | null => {
    const jr = q.joinRequestById.get(requestId) as any;
    return jr && jr.status === 'pending' && classInOrg(jr.class_id, orgId) ? jr : null;
  };

  app.post('/api/wx/join-requests/:id/link', (req, res) => {
    const teacher = wxTeacherOf(res);
    if (!teacher) return res.status(403).json({ error: '未绑定老师账号' });
    const jr = pendingRequestFor(req.params.id, teacher.org_id);
    if (!jr) return res.status(404).json({ error: 'request not found' });
    const studentId = str(req.body?.studentId);
    const student = studentId ? (q.studentById.get(studentId) as any) : null;
    if (!student || student.class_id !== jr.class_id) return res.status(400).json({ error: '学生不在该班' });
    // Candidate list already hides archived students; belt-and-braces here.
    // Suspended students CAN be linked (they're expected back).
    if (student.status === 'archived') return res.status(400).json({ error: '学生已归档' });
    linkJoinRequest(sqlite, { requestId: jr.id, studentId: student.id, teacherId: teacher.id });
    res.json({ ok: true });
  });

  app.post('/api/wx/join-requests/:id/dismiss', (req, res) => {
    const teacher = wxTeacherOf(res);
    if (!teacher) return res.status(403).json({ error: '未绑定老师账号' });
    const jr = pendingRequestFor(req.params.id, teacher.org_id);
    if (!jr) return res.status(404).json({ error: 'request not found' });
    dismissJoinRequest(sqlite, { requestId: jr.id, teacherId: teacher.id });
    res.json({ ok: true });
  });

  // ---- wx parent side --------------------------------------------------------

  app.get('/api/wx/invites/:token', (req, res) => {
    const inv = q.inviteByToken.get(req.params.token) as any;
    if (!inv) return res.status(404).json({ error: '邀请已过期或不存在，请向老师索取新邀请' });
    res.json(classPreview(q.classById.get(inv.class_id)));
  });

  // Photo goes up first, the returned key is then submitted with the join.
  // Server-relay instead of presigned PUT because wx.uploadFile only speaks
  // POST multipart.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
  });
  const PHOTO_EXT: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };

  app.post('/api/wx/upload/photo', upload.single('photo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '仅支持图片文件' });
    const key = `students/${nanoid(16)}.${PHOTO_EXT[req.file.mimetype] ?? 'jpg'}`;
    const url = await storageClient.putObject({ key, body: req.file.buffer, contentType: req.file.mimetype });
    res.status(201).json({ key, url });
  });

  const PHONE_RE = /^1\d{10}$/;

  app.post('/api/wx/invites/:token/join', (req, res) => {
    const inv = q.inviteByToken.get(req.params.token) as any;
    if (!inv) return res.status(404).json({ error: '邀请已过期或不存在，请向老师索取新邀请' });
    const cnName = str(req.body?.cnName);
    if (!cnName) return res.status(400).json({ error: '中文名必填' });
    const parentPhone = str(req.body?.parentPhone);
    if (parentPhone && !PHONE_RE.test(parentPhone)) return res.status(400).json({ error: '手机号需为 11 位数字' });
    const id = upsertJoinRequest(sqlite, {
      classId: inv.class_id,
      wechatAccountId: res.locals.wxAccount.id,
      inviteId: inv.id,
      cnName,
      enName: str(req.body?.enName),
      parentPhone,
      photoKey: str(req.body?.photoKey),
    });
    const c = q.classById.get(inv.class_id) as any;
    res.status(201).json({ id, classId: inv.class_id, className: c.name, status: 'pending' });
  });

  /** The student row if the current wx account holds a binding for it. */
  const boundStudent = (studentId: string, accountId: string): any | null =>
    q.bindingOf.get(studentId, accountId) ? ((q.studentById.get(studentId) as any) ?? null) : null;

  app.get('/api/wx/students/:id', (req, res) => {
    const st = boundStudent(req.params.id, res.locals.wxAccount.id);
    if (!st) return res.status(404).json({ error: 'not found' });
    const c = q.classById.get(st.class_id) as any;
    const sessions = (q.endedSessionsOfClass.all(c.id) as any[]).map((s) => ({
      id: s.id,
      date: md(s.date),
      year: s.date.slice(0, 4),
      weekday: weekdayCN(s.date),
      lessonNumber: s.lesson_number,
      lessonTitle: s.lesson_title,
    }));
    res.json({
      student: {
        id: st.id,
        name: st.name,
        enName: st.en_name,
        photoUrl: st.photo_url ? storageClient.getUrl(st.photo_url) : null,
      },
      class: { id: c.id, name: c.name, ...classPreview(c) },
      sessions,
      latestSessionId: sessions[0]?.id ?? null,
    });
  });

  app.get('/api/wx/students/:id/sessions/:sessionId', (req, res) => {
    const st = boundStudent(req.params.id, res.locals.wxAccount.id);
    if (!st) return res.status(404).json({ error: 'not found' });
    const s = q.sessionById.get(req.params.sessionId) as any;
    if (!s || s.class_id !== st.class_id || s.status !== 'ended') return res.status(404).json({ error: 'not found' });

    const recap = buildRecap(s);
    const mem = q.membershipOfStudent.get(s.id, st.id) as any;
    // No membership = the student joined after this lesson → no personal card.
    let mine = null;
    if (mem) {
      const checks = new Map((q.checksOfStudent.all(s.id, st.id) as any[]).map((r) => [r.type, r.status]));
      const grp = recap.groups.find((g) => g.id === mem.session_group_id);
      mine = {
        attended: mem.attendance === 'present',
        groupName: grp?.name ?? null,
        groupEmoji: grp?.emoji ?? null,
        // Personal score counts student-target events only (§7.4/§7.5 口径);
        // missing homework record = 没交, missing recitation record = 未检查 (§8).
        personalScore: (q.personalScoreOfStudent.get(s.id, st.id) as any)?.s ?? 0,
        homework: checks.get('homework') ?? '没交',
        recitation: checks.get('recitation') ?? '未检查',
        // 奖章 — by student_id, NOT via recap.studentTags (name-keyed, dup-unsafe)
        tags: (q.tagsOfStudentSession.all(s.id, st.id) as any[]).map((r) => r.tag_name),
      };
    }
    res.json({
      ...recap,
      groups: recap.groups.map((g) => ({ ...g, mine: g.id === (mem?.session_group_id ?? null) && mem != null })),
      mine,
    });
  });

  // ---- auth gate: everything under /api except health + login (+ /api/wx/*,
  // handled by the Bearer gate above; unmatched wx paths fall through to 401) --
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

  // Re-confirm the logged-in teacher's password for destructive actions
  // (放弃本节课). 403 on mismatch — the session itself stays valid.
  app.post('/api/auth/verify-password', (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const cred = q.credByTeacher.get(res.locals.teacher.id) as any;
    if (!password || !cred?.secret || !verifyPassword(password, cred.secret)) {
      return res.status(403).json({ error: '密码错误' });
    }
    res.json({ ok: true });
  });

  // ---- teachers (同校老师列表 + 管理页添加; 权限暂不细分, 任何登录老师可加) ----
  app.get('/api/teachers', (_req, res) => {
    const rows = q.teachersOfOrg.all(res.locals.teacher.org_id) as any[];
    res.json(rows.map((t) => ({ id: t.id, name: t.name, username: t.username, role: t.role })));
  });

  // ---- org 奖章 tag 库 (课堂打 tag 的下拉数据源; 写入只走 end-class commit 的 upsert) ----
  app.get('/api/tags', (_req, res) => {
    const rows = q.tagsOfOrg.all(res.locals.teacher.org_id) as any[];
    res.json(rows.map((t) => ({ id: t.id, name: t.name })));
  });

  app.post('/api/teachers', (req, res) => {
    const name = str(req.body?.name);
    const username = str(req.body?.username);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!name || !username) return res.status(400).json({ error: '姓名和用户名必填' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
    if (q.teacherByUsername.get(username)) return res.status(409).json({ error: '用户名已被使用' });
    const id = createTeacher(sqlite, { orgId: res.locals.teacher.org_id, name, username, password });
    const t = q.teacherById.get(id) as any;
    res.status(201).json({ id: t.id, name: t.name, username: t.username, role: t.role });
  });

  // ---- teacher 编辑 (改名 + 可选改密; username immutable, 任何同校老师可改) ----
  app.put('/api/teachers/:id', (req, res) => {
    const acting = res.locals.teacher;
    const t = q.teacherById.get(req.params.id) as any;
    if (!t || t.org_id !== acting.org_id) return res.status(404).json({ error: 'teacher not found' });
    const name = str(req.body?.name);
    if (!name) return res.status(400).json({ error: '姓名必填' });
    // Password optional (不 trim — spaces may be intentional): blank/absent leaves
    // the credential unchanged, a provided one must still be ≥6.
    const raw = typeof req.body?.password === 'string' ? req.body.password : '';
    const password = raw.length > 0 ? raw : null;
    if (password != null && password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
    updateTeacher(sqlite, { teacherId: t.id, name, password });
    const updated = q.teacherById.get(t.id) as any;
    res.json({ id: updated.id, name: updated.name, username: updated.username, role: updated.role });
  });

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
    const textbook = bookOr(req.body?.textbook);
    if (textbook === 'invalid') return res.status(400).json({ error: '教材册数必须是 1-4' });
    // 负责老师 optional on create; defaults to the acting teacher (mirrors PUT's same-org check).
    const teacherId = str(req.body?.teacherId) ?? teacher.id;
    const t = q.teacherById.get(teacherId) as any;
    if (!t || t.org_id !== teacher.org_id) return res.status(400).json({ error: '负责老师不存在或不属于本校' });
    const id = createClass(sqlite, { orgId: teacher.org_id, name, teacherId, textbook });
    res.status(201).json(classDetailPayload(id));
  });

  // ---- class basic info (name / 负责老师, full replace) ----
  app.put('/api/classes/:id', (req, res) => {
    const teacher = res.locals.teacher;
    if (!classInOrg(req.params.id, teacher.org_id)) return res.status(404).json({ error: 'class not found' });
    const name = str(req.body?.name);
    if (!name) return res.status(400).json({ error: '班级名称必填' });
    const teacherId = str(req.body?.teacherId);
    if (!teacherId) return res.status(400).json({ error: '负责老师必填' });
    const t = q.teacherById.get(teacherId) as any;
    if (!t || t.org_id !== teacher.org_id) return res.status(400).json({ error: '负责老师不存在或不属于本校' });
    const textbook = bookOr(req.body?.textbook);
    if (textbook === 'invalid') return res.status(400).json({ error: '教材册数必须是 1-4' });
    updateClassInfo(sqlite, req.params.id, { name, teacherId, textbook });
    res.json(classDetailPayload(req.params.id));
  });

  // ---- students (write) ----
  app.post('/api/classes/:id/students', (req, res) => {
    const teacher = res.locals.teacher;
    if (!classInOrg(req.params.id, teacher.org_id)) return res.status(404).json({ error: 'class not found' });
    const name = str(req.body?.name);
    if (!name) return res.status(400).json({ error: '学生姓名必填' });
    const id = addStudent(sqlite, { classId: req.params.id, name });
    const s = q.studentById.get(id) as any;
    res
      .status(201)
      .json({ id: s.id, name: s.name, source: s.source, status: s.status, hasPhoto: s.photo_url != null, score: 0 });
  });

  // ---- student basic info (rename) ----
  app.put('/api/students/:id', (req, res) => {
    const teacher = res.locals.teacher;
    const s = q.studentById.get(req.params.id) as any;
    if (!s || !classInOrg(s.class_id, teacher.org_id)) return res.status(404).json({ error: 'student not found' });
    const name = str(req.body?.name);
    if (!name) return res.status(400).json({ error: '学生姓名必填' });
    renameStudent(sqlite, s.id, name);
    const updated = q.studentById.get(s.id) as any;
    res.json({
      id: updated.id,
      name: updated.name,
      source: updated.source,
      status: updated.status,
      hasPhoto: updated.photo_url != null,
    });
  });

  // ---- student status (在读/停课/归档; non-active leaves the default grouping) ----
  app.put('/api/students/:id/status', (req, res) => {
    const teacher = res.locals.teacher;
    const s = q.studentById.get(req.params.id) as any;
    if (!s || !classInOrg(s.class_id, teacher.org_id)) return res.status(404).json({ error: 'student not found' });
    const status = str(req.body?.status);
    if (status !== 'active' && status !== 'suspended' && status !== 'archived') {
      return res.status(400).json({ error: 'status 必须是 active / suspended / archived' });
    }
    setStudentStatus(sqlite, s.id, status);
    const updated = q.studentById.get(s.id) as any;
    res.json({
      id: updated.id,
      name: updated.name,
      source: updated.source,
      status: updated.status,
      hasPhoto: updated.photo_url != null,
    });
  });

  app.delete('/api/students/:id', (req, res) => {
    const teacher = res.locals.teacher;
    const s = q.studentById.get(req.params.id) as any;
    if (!s || !classInOrg(s.class_id, teacher.org_id)) return res.status(404).json({ error: 'student not found' });
    deleteStudent(sqlite, req.params.id);
    res.json({ ok: true });
  });

  // ---- student growth profile (§7.4, pure read derivation) ----
  // Not status-filtered: suspended/archived students keep their history viewable.
  app.get('/api/students/:id/profile', (req, res) => {
    const teacher = res.locals.teacher;
    const st = q.studentById.get(req.params.id) as any;
    const c = st ? classInOrg(st.class_id, teacher.org_id) : null;
    if (!st || !c) return res.status(404).json({ error: 'student not found' });

    const sessions = (q.endedSessionsOfClass.all(c.id) as any[]).reverse().map((s) => {
      const mem = q.membershipOfStudent.get(s.id, st.id) as any;
      // No membership = the student joined after this lesson (未入班), which is
      // NOT the same as an explicit absence (that row exists, attendance=absent).
      let mine = null;
      if (mem) {
        const checks = new Map((q.checksOfStudent.all(s.id, st.id) as any[]).map((r) => [r.type, r.status]));
        const grp = mem.session_group_id
          ? ((q.sessionGroups.all(s.id) as any[]).find((g) => g.id === mem.session_group_id) ?? null)
          : null;
        const groupScore = grp
          ? ((q.sessionGroupScores.all(s.id) as any[]).find((r) => r.gid === grp.id)?.score ?? 0)
          : null;
        mine = {
          attended: mem.attendance === 'present',
          groupName: grp?.name ?? null,
          groupEmoji: grp?.emoji ?? null,
          groupScore,
          // Personal score counts student-target events only (§7.4 口径);
          // missing homework record = 没交, missing recitation record = 未检查 (§8).
          personalScore: (q.personalScoreOfStudent.get(s.id, st.id) as any)?.s ?? 0,
          homework: checks.get('homework') ?? '没交',
          recitation: checks.get('recitation') ?? '未检查',
        };
      }
      return {
        id: s.id,
        date: md(s.date),
        year: s.date.slice(0, 4),
        weekday: weekdayCN(s.date),
        lessonNumber: s.lesson_number,
        lessonTitle: s.lesson_title,
        mine,
      };
    });

    const grp = q.defaultGroupOfStudent.get(st.id) as any;
    const tally = q.personalTallyOfStudent.get(st.id) as any;
    res.json({
      student: {
        id: st.id,
        name: st.name,
        source: st.source,
        status: st.status,
        photoUrl: st.photo_url ? storageClient.getUrl(st.photo_url) : null,
      },
      class: { id: c.id, name: c.name },
      currentGroup: grp ? { name: grp.name, emoji: grp.emoji } : null,
      totals: {
        attended: sessions.filter((s) => s.mine?.attended).length,
        personalTotal: tally.total,
        plus: tally.plus,
        minus: tally.minus,
      },
      sessions,
    });
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

  // ---- class notes (班级资源 markdown; blank replaces with null) ----
  app.put('/api/classes/:id/notes', (req, res) => {
    const teacher = res.locals.teacher;
    if (!classInOrg(req.params.id, teacher.org_id)) return res.status(404).json({ error: 'class not found' });
    const raw = req.body?.notes;
    if (typeof raw !== 'string') return res.status(400).json({ error: 'notes 必须是字符串' });
    setClassNotes(sqlite, req.params.id, raw.trim() ? raw : null);
    res.json(classDetailPayload(req.params.id));
  });

  // ---- class homework template (作业模板; blank replaces with null) ----
  app.put('/api/classes/:id/homework-template', (req, res) => {
    const teacher = res.locals.teacher;
    if (!classInOrg(req.params.id, teacher.org_id)) return res.status(404).json({ error: 'class not found' });
    const raw = req.body?.template;
    if (typeof raw !== 'string') return res.status(400).json({ error: 'template 必须是字符串' });
    setHomeworkTemplate(sqlite, req.params.id, raw.trim() ? raw : null);
    res.json(classDetailPayload(req.params.id));
  });

  // ---- end-class commit (offline-first one-shot; the only session write) ----
  app.post('/api/classes/:id/sessions', (req, res) => {
    const teacher = res.locals.teacher;
    if (!classInOrg(req.params.id, teacher.org_id)) return res.status(404).json({ error: 'class not found' });

    const built = buildCommitInput(req.body, req.params.id, teacher);
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

  // ---- join-request queue (read-only mirror; handling happens in the miniapp) ----
  app.get('/api/classes/:id/join-requests', (req, res) => {
    const teacher = res.locals.teacher;
    if (!classInOrg(req.params.id, teacher.org_id)) return res.status(404).json({ error: 'class not found' });
    res.json((q.pendingRequestsOfClass.all(req.params.id) as any[]).map(joinRequestItem));
  });

  // ---- org-wide session list (管理页「课堂」; class/date filtering happens client-side) ----
  app.get('/api/sessions', (_req, res) => {
    const sgCounts = new Map((q.sessionGroupCounts.all() as any[]).map((r) => [r.session_id, r.c]));
    const rows = (q.sessionsOfOrg.all(res.locals.teacher.org_id) as any[]).map((s) => ({
      ...sessionSummary(s, sgCounts.get(s.id) ?? 0),
      classId: s.class_id,
      className: s.class_name,
    }));
    res.json(rows);
  });

  // ---- session deletion (rolls back one committed session; grouping writeback stays) ----
  app.delete('/api/sessions/:id', (req, res) => {
    const teacher = res.locals.teacher;
    const s = q.sessionById.get(req.params.id) as any;
    if (!s || !classInOrg(s.class_id, teacher.org_id)) return res.status(404).json({ error: 'session not found' });
    deleteSession(sqlite, req.params.id);
    res.json({ ok: true });
  });

  // ---- session info edit (课堂信息: 课次/课题/主讲老师/开始时间 record fix-up) ----
  // Partial update: only keys present in the body are validated and written, so
  // the older {startedAt}-only caller (上课记录 改时间) keeps working unchanged.
  app.put('/api/sessions/:id', (req, res) => {
    const teacher = res.locals.teacher;
    const s = q.sessionById.get(req.params.id) as any;
    const c = s ? classInOrg(s.class_id, teacher.org_id) : null;
    if (!s || !c) return res.status(404).json({ error: 'session not found' });
    const b = req.body ?? {};
    const patch: Parameters<typeof updateSessionInfo>[2] = {};
    if ('startedAt' in b) {
      const startedAt = str(b.startedAt);
      if (!startedAt || !TIME_RE.test(startedAt))
        return res.status(400).json({ error: 'startedAt 必须是 YYYY-MM-DD HH:mm:ss' });
      // Same naive format on both sides, so plain string order IS chronological order.
      if (s.ended_at && startedAt >= s.ended_at) return res.status(400).json({ error: '开始时间必须早于结束时间' });
      patch.startedAt = startedAt;
    }
    if ('lessonNumber' in b) {
      if (b.lessonNumber != null && (!Number.isInteger(b.lessonNumber) || b.lessonNumber < 1))
        return res.status(400).json({ error: '课次号必须是正整数' });
      patch.lessonNumber = b.lessonNumber ?? null;
    }
    if ('lessonTitle' in b) {
      if (b.lessonTitle != null && typeof b.lessonTitle !== 'string')
        return res.status(400).json({ error: '课题必须是字符串' });
      patch.lessonTitle = typeof b.lessonTitle === 'string' && b.lessonTitle.trim() ? b.lessonTitle.trim() : null;
    }
    if ('teacherId' in b) {
      if (b.teacherId == null) patch.teacherId = null;
      else {
        const t = q.teacherById.get(b.teacherId) as any;
        if (!t || t.org_id !== teacher.org_id) return res.status(400).json({ error: '主讲老师不存在或不属于本校' });
        patch.teacherId = b.teacherId;
      }
    }
    updateSessionInfo(sqlite, s.id, patch);
    res.json(sessionDetailPayload(q.sessionById.get(s.id) as any, c));
  });

  // ---- session overwrite (编辑上课记录: re-commit the whole ledger onto an existing session) ----
  // Keyed by the existing session id (like every other session route), reuses the
  // end-class buildCommitInput contract verbatim, and preserves the session id so
  // /sessions/:sid links, 考勤 history and parent recaps stay valid. Unlike POST
  // it never writes back the default grouping (see overwriteSession).
  app.put('/api/sessions/:id/commit', (req, res) => {
    const teacher = res.locals.teacher;
    const s = q.sessionById.get(req.params.id) as any;
    const c = s ? classInOrg(s.class_id, teacher.org_id) : null;
    if (!s || !c) return res.status(404).json({ error: 'session not found' });
    const built = buildCommitInput(req.body, s.class_id, teacher);
    if ('error' in built) return res.status(400).json({ error: built.error });
    overwriteSession(sqlite, s.id, built.input);
    const row = q.sessionById.get(s.id) as any;
    res.json({ sessionId: s.id, recap: buildRecap(row), created: false });
  });

  // ---- session detail (summary + class context + 作业布置 + embedded recap) ----
  app.get('/api/sessions/:id', (req, res) => {
    const teacher = res.locals.teacher;
    const s = q.sessionById.get(req.params.id) as any;
    const c = s ? classInOrg(s.class_id, teacher.org_id) : null;
    if (!s || !c) return res.status(404).json({ error: 'session not found' });
    res.json(sessionDetailPayload(s, c));
  });

  // ---- session homework (完成布置: content + 课文复习; post-commit edit) ----
  app.put('/api/sessions/:id/homework', (req, res) => {
    const teacher = res.locals.teacher;
    const s = q.sessionById.get(req.params.id) as any;
    const c = s ? classInOrg(s.class_id, teacher.org_id) : null;
    if (!s || !c) return res.status(404).json({ error: 'session not found' });

    const rawContent = req.body?.content;
    if (rawContent != null && typeof rawContent !== 'string')
      return res.status(400).json({ error: 'content 必须是字符串' });
    const content = contentOrNull(rawContent);
    const reviewBook = bookOr(req.body?.reviewBook);
    if (reviewBook === 'invalid') return res.status(400).json({ error: '课文复习册数必须是 1-4' });
    let reviewLesson: number | null = null;
    if (req.body?.reviewLesson != null) {
      if (reviewBook == null) return res.status(400).json({ error: '课文复习需要先选择册数' });
      const n = req.body.reviewLesson;
      if (!Number.isInteger(n) || n < 1 || n > BOOK_LESSON_COUNTS[reviewBook])
        return res.status(400).json({ error: `课文复习课数必须在 1-${BOOK_LESSON_COUNTS[reviewBook]} 之间` });
      reviewLesson = n;
    }
    setSessionHomework(sqlite, s.id, { content, reviewBook, reviewLesson });
    res.json(sessionDetailPayload(q.sessionById.get(s.id) as any, c));
  });

  // ---- 考勤 (attendance history grid: sessions × students) ----
  app.get('/api/classes/:id/attendance', (req, res) => {
    const c = classInOrg(req.params.id, res.locals.teacher.org_id);
    if (!c) return res.status(404).json({ error: 'class not found' });
    const sessions = (q.attendanceSessionsOfClass.all(c.id) as any[]).map((s) => ({
      id: s.id,
      date: s.date,
      startedAt: s.started_at,
      lessonNumber: s.lesson_number,
      lessonTitle: s.lesson_title,
    }));
    const students = (q.attendanceStudentsOfClass.all(c.id) as any[]).map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
    }));
    const records = (q.attendanceRecordsOfClass.all(c.id) as any[]).map((r) => ({
      sessionId: r.sid,
      studentId: r.stid,
      status: r.attendance,
      madeUp: r.made_up === 1,
    }));
    res.json({ classId: c.id, className: c.name, sessions, students, records });
  });

  // ---- 考勤 correction (status + 补课 flag; cells without a membership row stay locked) ----
  app.put('/api/sessions/:id/attendance/:studentId', (req, res) => {
    const teacher = res.locals.teacher;
    const s = q.sessionById.get(req.params.id) as any;
    if (!s || !classInOrg(s.class_id, teacher.org_id)) return res.status(404).json({ error: 'session not found' });
    const status = str(req.body?.status);
    if (status !== 'present' && status !== 'absent' && status !== 'leave')
      return res.status(400).json({ error: 'status 必须是 present / absent / leave' });
    const mem = q.membershipOfStudent.get(s.id, req.params.studentId) as any;
    if (!mem) return res.status(404).json({ error: 'attendance record not found' });
    // 补课 only makes sense for a missed class; going back to present clears it.
    const madeUp = status !== 'present' && req.body?.madeUp === true;
    setAttendance(sqlite, { sessionId: s.id, studentId: req.params.studentId, status, madeUp });
    res.json({ sessionId: s.id, studentId: req.params.studentId, status, madeUp });
  });

  // ---- recap (read) ----
  app.get('/api/sessions/:id/recap', (req, res) => {
    const teacher = res.locals.teacher;
    const s = q.sessionById.get(req.params.id) as any;
    if (!s || !classInOrg(s.class_id, teacher.org_id)) return res.status(404).json({ error: 'session not found' });
    res.json(buildRecap(s));
  });

  // Multer surfaces its limit violations (e.g. fileSize) via next(err); map
  // them to 400 instead of express's default 500.
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `上传失败：${err.code}` });
    next(err);
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
