import type DatabaseType from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { hashPassword } from '../auth/password.js';

type DB = DatabaseType.Database;

export interface GroupInput {
  id?: string | null;
  name: string;
  emoji: string | null;
  orderIndex: number;
  memberIds: string[];
}

export interface CommitSessionGroup {
  clientId: string;
  name: string;
  emoji: string | null;
  orderIndex: number;
}
export interface CommitMembership {
  studentId: string;
  clientGroupId: string | null;
  attendance: string;
}
export interface CommitEvent {
  targetType: string;
  targetId: string;
  clientGroupId: string | null;
  delta: number;
  createdAt: string;
}
export interface CommitCheck {
  studentId: string;
  type: string;
  status: string;
}
export interface CommitTag {
  studentId: string;
  tag: string; // normalised 奖章 name (buildCommitInput trims/collapses/caps it)
}
// The validated end-class commit (built by app.ts buildCommitInput — see its
// ⚠️ SCHEMA COMPAT note: the wire payload evolves protobuf-style, so every
// field added here after the first classroom release must stay optional on
// the wire with a server-side default).
export interface CommitInput {
  classId: string;
  teacherId: string;
  orgId: string; // acting teacher's org — org_tags upsert target
  clientSessionId: string;
  date: string; // startedAt's date (decision 9)
  lessonNumber: number | null;
  lessonTitle: string | null;
  plannedDurationMin: number;
  startedAt: string;
  endedAt: string;
  defaultGrouping: GroupInput[]; // §7.2 writeback (open-time grouping)
  sessionGroups: CommitSessionGroup[];
  memberships: CommitMembership[];
  events: CommitEvent[];
  checks: CommitCheck[];
  tags: CommitTag[]; // 奖章 (absent on old-client payloads → [])
}

/**
 * Create a same-org teacher account with a password credential (in-app 添加老师,
 * unlike provision.createTeacher which bootstraps an org by name). Returns the id.
 */
export function createTeacher(
  sqlite: DB,
  p: { orgId: string; name: string; username: string; password: string },
): string {
  const id = `t-${nanoid(10)}`;
  const tx = sqlite.transaction(() => {
    sqlite
      .prepare(`INSERT INTO teachers (id, org_id, name, username, role) VALUES (?,?,?,?,'teacher')`)
      .run(id, p.orgId, p.name, p.username);
    sqlite
      .prepare(`INSERT INTO credentials (id, teacher_id, provider, secret) VALUES (?,?,'password',?)`)
      .run(`cred-${nanoid(10)}`, id, hashPassword(p.password));
  });
  tx();
  return id;
}

/**
 * Rename a teacher and optionally reset their password (in-app 老师编辑). The
 * username is immutable here. `password === null` leaves the credential
 * untouched (blank = 不修改); a string is re-hashed into the password credential.
 */
export function updateTeacher(sqlite: DB, p: { teacherId: string; name: string; password: string | null }): void {
  const tx = sqlite.transaction(() => {
    sqlite.prepare(`UPDATE teachers SET name=? WHERE id=?`).run(p.name, p.teacherId);
    if (p.password != null) {
      sqlite
        .prepare(`UPDATE credentials SET secret=? WHERE teacher_id=? AND provider='password'`)
        .run(hashPassword(p.password), p.teacherId);
    }
  });
  tx();
}

/** Create a class in the given org owned by the given teacher. Returns its id. */
export function createClass(
  sqlite: DB,
  p: { orgId: string; name: string; teacherId: string; textbook: number | null },
): string {
  const id = `c-${nanoid(10)}`;
  sqlite
    .prepare(`INSERT INTO classes (id, org_id, name, teacher_id, textbook) VALUES (?,?,?,?,?)`)
    .run(id, p.orgId, p.name, p.teacherId, p.textbook);
  return id;
}

/** Update a class's basic info (name / 负责老师 / 教材册数). */
export function updateClassInfo(
  sqlite: DB,
  classId: string,
  p: { name: string; teacherId: string; textbook: number | null },
): void {
  sqlite
    .prepare(`UPDATE classes SET name=?, teacher_id=?, textbook=? WHERE id=?`)
    .run(p.name, p.teacherId, p.textbook, classId);
}

/** Add a teacher-created student to a class. Returns the new student id. */
export function addStudent(sqlite: DB, p: { classId: string; name: string }): string {
  const id = `s-${nanoid(10)}`;
  sqlite
    .prepare(`INSERT INTO students (id, class_id, name, photo_url, source, recap_token) VALUES (?,?,?,?,?,?)`)
    .run(id, p.classId, p.name, null, 'teacher', nanoid(24));
  return id;
}

/** Rename a student (基本信息编辑). */
export function renameStudent(sqlite: DB, studentId: string, name: string): void {
  sqlite.prepare(`UPDATE students SET name=? WHERE id=?`).run(name, studentId);
}

/** wx.login upsert: create the account on first sight, stamp last_login_at. Returns the id. */
export function upsertWechatAccount(sqlite: DB, p: { openid: string; unionid: string | null }): string {
  const existing = sqlite.prepare(`SELECT id FROM wechat_accounts WHERE openid=?`).get(p.openid) as any;
  if (existing) {
    sqlite.prepare(`UPDATE wechat_accounts SET last_login_at=datetime('now') WHERE id=?`).run(existing.id);
    return existing.id;
  }
  const id = `wa-${nanoid(10)}`;
  sqlite
    .prepare(`INSERT INTO wechat_accounts (id, openid, unionid, last_login_at) VALUES (?,?,?,datetime('now'))`)
    .run(id, p.openid, p.unionid);
  return id;
}

/** Bind a wechat account to a teacher: one provider='wechat' credential row. */
export function bindTeacherWechat(sqlite: DB, p: { teacherId: string; wechatAccountId: string }): void {
  sqlite
    .prepare(`INSERT INTO credentials (id, teacher_id, provider, wechat_account_id) VALUES (?,?,'wechat',?)`)
    .run(nanoid(), p.teacherId, p.wechatAccountId);
}

/** One-shot expiring invite (default 7 days). Returns the row for sharing. */
export function createInvite(
  sqlite: DB,
  p: { classId: string; teacherId: string },
): { id: string; token: string; expiresAt: string } {
  const id = `inv-${nanoid(10)}`;
  const token = nanoid(16);
  sqlite
    .prepare(
      `INSERT INTO class_invites (id, class_id, token, created_by, expires_at)
       VALUES (?,?,?,?, datetime('now', '+7 days'))`,
    )
    .run(id, p.classId, token, p.teacherId);
  const row = sqlite.prepare(`SELECT expires_at FROM class_invites WHERE id=?`).get(id) as any;
  return { id, token, expiresAt: row.expires_at };
}

export interface JoinRequestInput {
  classId: string;
  wechatAccountId: string;
  inviteId: string;
  cnName: string;
  enName: string | null;
  parentPhone: string | null;
  photoKey: string | null;
}

/**
 * Register through an invite. A resubmit while still pending overwrites the
 * pending row's fields (decision: 覆盖更新) instead of erroring on the partial
 * unique index. Returns the join_request id.
 */
export function upsertJoinRequest(sqlite: DB, p: JoinRequestInput): string {
  const existing = sqlite
    .prepare(`SELECT id FROM join_requests WHERE class_id=? AND wechat_account_id=? AND status='pending'`)
    .get(p.classId, p.wechatAccountId) as any;
  if (existing) {
    sqlite
      .prepare(`UPDATE join_requests SET invite_id=?, cn_name=?, en_name=?, parent_phone=?, photo_key=? WHERE id=?`)
      .run(p.inviteId, p.cnName, p.enName, p.parentPhone, p.photoKey, existing.id);
    return existing.id;
  }
  const id = `jr-${nanoid(10)}`;
  sqlite
    .prepare(
      `INSERT INTO join_requests (id, class_id, wechat_account_id, invite_id, cn_name, en_name, parent_phone, photo_key)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(id, p.classId, p.wechatAccountId, p.inviteId, p.cnName, p.enName, p.parentPhone, p.photoKey);
  return id;
}

/**
 * Link a pending join_request to an existing student (single transaction):
 * ① create the student↔account binding (idempotent), ② mark the request
 * linked, ③ backfill the student's EMPTY fields from the registration —
 * photo/en_name/parent_phone never overwrite values the teacher already set.
 */
export function linkJoinRequest(sqlite: DB, p: { requestId: string; studentId: string; teacherId: string }): void {
  const tx = sqlite.transaction(() => {
    const req = sqlite.prepare(`SELECT * FROM join_requests WHERE id=?`).get(p.requestId) as any;
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO student_wechat_bindings (id, student_id, wechat_account_id, created_by)
         VALUES (?,?,?,?)`,
      )
      .run(nanoid(), p.studentId, req.wechat_account_id, p.teacherId);
    sqlite
      .prepare(
        `UPDATE join_requests SET status='linked', linked_student_id=?, handled_by=?, handled_at=datetime('now') WHERE id=?`,
      )
      .run(p.studentId, p.teacherId, p.requestId);
    sqlite
      .prepare(
        `UPDATE students SET photo_url=COALESCE(photo_url, ?), en_name=COALESCE(en_name, ?), parent_phone=COALESCE(parent_phone, ?) WHERE id=?`,
      )
      .run(req.photo_key, req.en_name, req.parent_phone, p.studentId);
  });
  tx();
}

/** Dismiss a pending join_request (kept for history, just leaves the queue). */
export function dismissJoinRequest(sqlite: DB, p: { requestId: string; teacherId: string }): void {
  sqlite
    .prepare(`UPDATE join_requests SET status='dismissed', handled_by=?, handled_at=datetime('now') WHERE id=?`)
    .run(p.teacherId, p.requestId);
}

/** Replace the class 班级资源 markdown (null clears it). */
export function setClassNotes(sqlite: DB, classId: string, notes: string | null): void {
  sqlite.prepare(`UPDATE classes SET notes=? WHERE id=?`).run(notes, classId);
}

/** Replace the class 作业模板 (null clears it). */
export function setHomeworkTemplate(sqlite: DB, classId: string, template: string | null): void {
  sqlite.prepare(`UPDATE classes SET homework_template=? WHERE id=?`).run(template, classId);
}

/**
 * Set one session's 作业布置 (content + 课文复习 selection). Authored on the
 * session detail page after the end-class commit — its own PUT, never part of
 * the commit payload, so the protobuf-compat contract is untouched.
 */
export function setSessionHomework(
  sqlite: DB,
  sessionId: string,
  p: { content: string | null; reviewBook: number | null; reviewLesson: number | null },
): void {
  sqlite
    .prepare(`UPDATE class_sessions SET homework_content=?, review_book=?, review_lesson=? WHERE id=?`)
    .run(p.content, p.reviewBook, p.reviewLesson, sessionId);
}

/**
 * 考勤 correction: rewrite one membership's attendance status (+补课 flag).
 * The group snapshot is left untouched — flipping present↔absent after the
 * fact must not lose where the student sat that day.
 */
export function setAttendance(
  sqlite: DB,
  p: { sessionId: string; studentId: string; status: string; madeUp: boolean },
): void {
  sqlite
    .prepare(`UPDATE session_memberships SET attendance=?, made_up=? WHERE session_id=? AND student_id=?`)
    .run(p.status, p.madeUp ? 1 : 0, p.sessionId, p.studentId);
}

/**
 * Set a student's status (active 在读 / suspended 停课 / archived 已归档).
 * Leaving active also removes them from the default grouping (decision 3);
 * coming back does NOT restore it — they reappear ungrouped.
 */
export function setStudentStatus(sqlite: DB, studentId: string, status: string): void {
  const tx = sqlite.transaction(() => {
    sqlite.prepare(`UPDATE students SET status=? WHERE id=?`).run(status, studentId);
    if (status !== 'active') {
      sqlite.prepare(`DELETE FROM class_group_memberships WHERE student_id=?`).run(studentId);
    }
  });
  tx();
}

/** Hard-delete a student and all ledger rows referencing them (single transaction). */
export function deleteStudent(sqlite: DB, studentId: string): void {
  const tx = sqlite.transaction((sid: string) => {
    sqlite.prepare(`DELETE FROM student_wechat_bindings WHERE student_id=?`).run(sid);
    sqlite.prepare(`DELETE FROM class_group_memberships WHERE student_id=?`).run(sid);
    sqlite.prepare(`DELETE FROM session_memberships WHERE student_id=?`).run(sid);
    sqlite.prepare(`DELETE FROM score_events WHERE target_type='student' AND target_id=?`).run(sid);
    sqlite.prepare(`DELETE FROM check_records WHERE student_id=?`).run(sid);
    sqlite.prepare(`DELETE FROM session_tags WHERE student_id=?`).run(sid);
    sqlite.prepare(`DELETE FROM students WHERE id=?`).run(sid);
  });
  tx(studentId);
}

/** Delete the 5 session-scoped child tables (everything but the class_sessions
 *  row). Shared by deleteSession (full rollback) and overwriteSession (re-commit).
 *  Not a transaction itself — the caller wraps it. */
function deleteSessionLedger(sqlite: DB, sessionId: string): void {
  sqlite.prepare(`DELETE FROM score_events WHERE session_id=?`).run(sessionId);
  sqlite.prepare(`DELETE FROM session_memberships WHERE session_id=?`).run(sessionId);
  sqlite.prepare(`DELETE FROM check_records WHERE session_id=?`).run(sessionId);
  sqlite.prepare(`DELETE FROM session_tags WHERE session_id=?`).run(sessionId);
  sqlite.prepare(`DELETE FROM session_groups WHERE session_id=?`).run(sessionId);
}

/**
 * Hard-delete an ended session and everything it committed (single transaction).
 * The default-grouping writeback is intentionally NOT reverted — the class keeps
 * its current grouping; the teacher can adjust it on the groups page.
 */
export function deleteSession(sqlite: DB, sessionId: string): void {
  const tx = sqlite.transaction((sid: string) => {
    deleteSessionLedger(sqlite, sid);
    sqlite.prepare(`DELETE FROM class_sessions WHERE id=?`).run(sid);
  });
  tx(sessionId);
}

/**
 * Patch a committed session's 课堂信息 (record fix-up from the session detail
 * page / 上课记录 改时间). Partial: only keys present in `p` are written.
 * The stored `date` follows startedAt (decision 9), so date labels and recap
 * ordering stay consistent; the actual duration is derived on read.
 */
export function updateSessionInfo(
  sqlite: DB,
  sessionId: string,
  p: { lessonNumber?: number | null; lessonTitle?: string | null; teacherId?: string | null; startedAt?: string },
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ('lessonNumber' in p) {
    sets.push('lesson_number=?');
    vals.push(p.lessonNumber);
  }
  if ('lessonTitle' in p) {
    sets.push('lesson_title=?');
    vals.push(p.lessonTitle);
  }
  if ('teacherId' in p) {
    sets.push('teacher_id=?');
    vals.push(p.teacherId);
  }
  if (p.startedAt !== undefined) {
    sets.push('started_at=?', 'date=?');
    vals.push(p.startedAt, p.startedAt.slice(0, 10));
  }
  if (!sets.length) return;
  sqlite.prepare(`UPDATE class_sessions SET ${sets.join(', ')} WHERE id=?`).run(...vals, sessionId);
}

/**
 * Replace a class's entire default grouping (PRD "save = update default group").
 * Idempotent: rebuilds class_groups + memberships from `groups`; any student not
 * listed in a group becomes ungrouped. Members are filtered to the class's
 * ACTIVE roster — suspended/archived students never hold a default-group seat
 * (covers both PUT groups and commitSession's §7.2 writeback).
 */
export function saveGrouping(sqlite: DB, classId: string, groups: GroupInput[]): void {
  const tx = sqlite.transaction(() => {
    const roster = new Set(
      (sqlite.prepare(`SELECT id FROM students WHERE class_id=? AND status='active'`).all(classId) as any[]).map(
        (r) => r.id,
      ),
    );
    // wipe existing grouping for this class
    sqlite
      .prepare(
        `DELETE FROM class_group_memberships
         WHERE class_group_id IN (SELECT id FROM class_groups WHERE class_id=?)`,
      )
      .run(classId);
    sqlite.prepare(`DELETE FROM class_groups WHERE class_id=?`).run(classId);

    const insGroup = sqlite.prepare(
      `INSERT INTO class_groups (id, class_id, name, emoji, order_index) VALUES (?,?,?,?,?)`,
    );
    const insMember = sqlite.prepare(
      `INSERT INTO class_group_memberships (id, class_group_id, student_id) VALUES (?,?,?)`,
    );
    groups.forEach((g, i) => {
      const gid = g.id && !g.id.startsWith('new-') ? g.id : `cg-${nanoid(10)}`;
      insGroup.run(gid, classId, g.name, g.emoji, g.orderIndex ?? i);
      for (const sid of g.memberIds) {
        if (roster.has(sid)) insMember.run(nanoid(), gid, sid);
      }
    });
  });
  tx();
}

/**
 * Write one session's ledger rows against an EXISTING class_sessions id:
 * ③ snapshot session_groups (building a clientId→sessionGroupId map),
 * ④ session_memberships (absent ⇒ null group, decision 8), ⑤ score_events
 * (group events' target_id + every event's session_group_id resolved via the
 * map so buildRecap's nested query matches), ⑥ check_records, ⑦ 奖章 tags.
 * Shared by the end-class commit (fresh id) and 编辑上课记录 overwrite (preserved
 * id). NOT a transaction itself — the caller wraps it.
 *
 * `corrections` (overwrite only) restores post-commit 考勤 fixes: a student the
 * new payload still marks not-present keeps their prior leave / 补课 (made_up)
 * instead of collapsing back to a plain absent row. Omitted → a plain commit.
 */
function writeSessionLedger(
  sqlite: DB,
  sessionId: string,
  input: CommitInput,
  corrections?: Map<string, { attendance: string; madeUp: number; groupId: string | null }>,
): void {
  // ③ session_groups + clientId → sessionGroupId map
  const groupIdByClient = new Map<string, string>();
  const insSg = sqlite.prepare(
    `INSERT INTO session_groups (id, session_id, name, emoji, order_index) VALUES (?,?,?,?,?)`,
  );
  input.sessionGroups.forEach((g, i) => {
    const sgid = `sg-${nanoid(10)}`;
    insSg.run(sgid, sessionId, g.name, g.emoji, g.orderIndex ?? i);
    groupIdByClient.set(g.clientId, sgid);
  });
  const mapGid = (clientId: string | null): string | null =>
    clientId ? (groupIdByClient.get(clientId) ?? null) : null;

  // ④ session_memberships (absent ⇒ null group; a preserved correction keeps leave/made_up)
  const insMem = sqlite.prepare(
    `INSERT INTO session_memberships (id, session_id, student_id, session_group_id, attendance, made_up) VALUES (?,?,?,?,?,?)`,
  );
  for (const m of input.memberships) {
    let attendance = m.attendance;
    let madeUp = 0;
    let sgid = m.attendance === 'absent' ? null : mapGid(m.clientGroupId);
    const corr = m.attendance !== 'present' ? corrections?.get(m.studentId) : undefined;
    if (corr) {
      attendance = corr.attendance; // 'leave' or 'absent'
      madeUp = corr.madeUp;
      // Restore the seat the 考勤 correction preserved (setAttendance keeps the
      // group when flipping present→leave), remapped onto the freshly re-inserted
      // session_groups; null if that group no longer exists in this payload.
      sgid = corr.groupId ? mapGid(corr.groupId) : null;
    }
    insMem.run(nanoid(), sessionId, m.studentId, sgid, attendance, madeUp);
  }

  // ⑤ score_events (group events' target_id resolves to the session group id)
  const insEv = sqlite.prepare(
    `INSERT INTO score_events (id, session_id, target_type, target_id, session_group_id, delta, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  for (const e of input.events) {
    const targetId = e.targetType === 'group' ? (mapGid(e.targetId) ?? e.targetId) : e.targetId;
    insEv.run(
      nanoid(),
      sessionId,
      e.targetType,
      targetId,
      mapGid(e.clientGroupId),
      e.delta,
      e.createdAt,
      input.teacherId,
    );
  }

  // ⑥ check_records
  const insCk = sqlite.prepare(
    `INSERT INTO check_records (id, session_id, student_id, type, status) VALUES (?,?,?,?,?)`,
  );
  for (const c of input.checks) insCk.run(nanoid(), sessionId, c.studentId, c.type, c.status);

  // ⑦ 奖章 tags: upsert the org library by name (INSERT OR IGNORE rides the
  // NOCASE unique index), then snapshot tag_name per award like session_groups
  // snapshots names — a future library rename never rewrites history.
  if (input.tags.length) {
    const insTag = sqlite.prepare(`INSERT OR IGNORE INTO org_tags (id, org_id, name, created_by) VALUES (?,?,?,?)`);
    const selTag = sqlite.prepare(`SELECT id FROM org_tags WHERE org_id=? AND name=? COLLATE NOCASE`);
    const insSt = sqlite.prepare(
      `INSERT INTO session_tags (id, session_id, student_id, tag_id, tag_name, created_by) VALUES (?,?,?,?,?,?)`,
    );
    for (const t of input.tags) {
      insTag.run(`tag-${nanoid(10)}`, input.orgId, t.tag, input.teacherId);
      const row = selTag.get(input.orgId, t.tag) as any;
      insSt.run(nanoid(), sessionId, t.studentId, row.id, t.tag, input.teacherId);
    }
  }
}

/**
 * Commit a finished classroom session in one transaction (§7.2/§7.3, decision 3):
 * ① write back the default grouping (reuses saveGrouping — the nested
 *    transaction auto-degrades to a savepoint), ② create the ended class_session,
 * then ③-⑦ writeSessionLedger. Returns the new session id.
 */
export function commitSession(sqlite: DB, input: CommitInput): string {
  const tx = sqlite.transaction((): string => {
    // ① default-grouping writeback (end-of-class grouping: any in-class 调组
    //    the client folded into input.defaultGrouping persists to the class)
    saveGrouping(sqlite, input.classId, input.defaultGrouping);

    // ② class_sessions
    const sessionId = `sess-${nanoid(10)}`;
    sqlite
      .prepare(
        `INSERT INTO class_sessions
           (id, class_id, teacher_id, date, lesson_number, lesson_title, status,
            planned_duration_min, started_at, ended_at, client_session_id)
         VALUES (?,?,?,?,?,?, 'ended', ?,?,?,?)`,
      )
      .run(
        sessionId,
        input.classId,
        input.teacherId,
        input.date,
        input.lessonNumber,
        input.lessonTitle,
        input.plannedDurationMin,
        input.startedAt,
        input.endedAt,
        input.clientSessionId,
      );

    writeSessionLedger(sqlite, sessionId, input); // ③-⑦
    return sessionId;
  });
  return tx();
}

/**
 * Overwrite an existing ended session's ledger in place (编辑上课记录). One
 * transaction: capture post-commit 考勤 corrections, delete the same 5 child
 * tables deleteSession clears (but NOT the class_sessions row), UPDATE the
 * session's scalar fields (id / client_session_id / homework_content preserved),
 * then re-run writeSessionLedger against the SAME id so /sessions/:id links,
 * 考勤 history and parent recaps stay valid.
 *
 * Deliberately does NOT write back the default grouping — editing a historical
 * session must never reshuffle the class's current default grouping.
 * input.defaultGrouping is validated (shared buildCommitInput) but ignored here.
 */
export function overwriteSession(sqlite: DB, sessionId: string, input: CommitInput): void {
  const tx = sqlite.transaction(() => {
    const corrections = new Map(
      (
        sqlite
          .prepare(
            `SELECT student_id sid, attendance, made_up, session_group_id FROM session_memberships
             WHERE session_id=? AND (attendance='leave' OR made_up=1)`,
          )
          .all(sessionId) as any[]
      ).map((r) => [
        r.sid as string,
        {
          attendance: r.attendance as string,
          madeUp: r.made_up as number,
          groupId: (r.session_group_id as string) ?? null,
        },
      ]),
    );

    deleteSessionLedger(sqlite, sessionId);

    sqlite
      .prepare(
        `UPDATE class_sessions SET teacher_id=?, date=?, lesson_number=?, lesson_title=?,
           planned_duration_min=?, started_at=?, ended_at=? WHERE id=?`,
      )
      .run(
        input.teacherId,
        input.date,
        input.lessonNumber,
        input.lessonTitle,
        input.plannedDurationMin,
        input.startedAt,
        input.endedAt,
        sessionId,
      );

    writeSessionLedger(sqlite, sessionId, input, corrections); // ③-⑦ against the preserved id
  });
  tx();
}
