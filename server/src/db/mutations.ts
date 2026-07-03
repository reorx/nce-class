import type DatabaseType from 'better-sqlite3';
import { nanoid } from 'nanoid';

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
export interface CommitInput {
  classId: string;
  teacherId: string;
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
}

/** Create a class in the given org owned by the given teacher. Returns its id. */
export function createClass(
  sqlite: DB,
  p: { orgId: string; name: string; level: string | null; teacherId: string },
): string {
  const id = `c-${nanoid(10)}`;
  sqlite
    .prepare(`INSERT INTO classes (id, org_id, name, level, teacher_id) VALUES (?,?,?,?,?)`)
    .run(id, p.orgId, p.name, p.level, p.teacherId);
  return id;
}

/** Add a teacher-created student to a class. Returns the new student id. */
export function addStudent(sqlite: DB, p: { classId: string; name: string }): string {
  const id = `s-${nanoid(10)}`;
  sqlite
    .prepare(`INSERT INTO students (id, class_id, name, photo_url, source, recap_token) VALUES (?,?,?,?,?,?)`)
    .run(id, p.classId, p.name, null, 'teacher', nanoid(24));
  return id;
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
    sqlite.prepare(`DELETE FROM students WHERE id=?`).run(sid);
  });
  tx(studentId);
}

/**
 * Hard-delete an ended session and everything it committed (single transaction).
 * The default-grouping writeback is intentionally NOT reverted — the class keeps
 * its current grouping; the teacher can adjust it on the groups page.
 */
export function deleteSession(sqlite: DB, sessionId: string): void {
  const tx = sqlite.transaction((sid: string) => {
    sqlite.prepare(`DELETE FROM score_events WHERE session_id=?`).run(sid);
    sqlite.prepare(`DELETE FROM session_memberships WHERE session_id=?`).run(sid);
    sqlite.prepare(`DELETE FROM check_records WHERE session_id=?`).run(sid);
    sqlite.prepare(`DELETE FROM session_groups WHERE session_id=?`).run(sid);
    sqlite.prepare(`DELETE FROM class_sessions WHERE id=?`).run(sid);
  });
  tx(sessionId);
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
 * Commit a finished classroom session in one transaction (§7.2/§7.3, decision 3):
 * ① write back the default grouping (reuses saveGrouping — the nested
 *    transaction auto-degrades to a savepoint), ② create the ended class_session,
 * ③ snapshot session_groups (building a clientId→sessionGroupId map),
 * ④ session_memberships (absent ⇒ null group, decision 8), ⑤ score_events
 * (group events' target_id + every event's session_group_id resolved via the
 * map so buildRecap's nested query matches), ⑥ check_records. Returns the new
 * session id.
 */
export function commitSession(sqlite: DB, input: CommitInput): string {
  const tx = sqlite.transaction((): string => {
    // ① default-grouping writeback (open-time grouping, NOT final memberships)
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

    // ④ session_memberships (absent ⇒ null group)
    const insMem = sqlite.prepare(
      `INSERT INTO session_memberships (id, session_id, student_id, session_group_id, attendance) VALUES (?,?,?,?,?)`,
    );
    for (const m of input.memberships) {
      const sgid = m.attendance === 'absent' ? null : mapGid(m.clientGroupId);
      insMem.run(nanoid(), sessionId, m.studentId, sgid, m.attendance);
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

    return sessionId;
  });
  return tx();
}
