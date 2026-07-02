import type DatabaseType from 'better-sqlite3';
import { customAlphabet, nanoid } from 'nanoid';

// Parents type this by hand in the miniapp, so lowercase alphanumerics only.
const inviteToken = customAlphabet('abcdefghijkmnpqrstuvwxyz23456789', 10);

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
    .prepare(`INSERT INTO classes (id, org_id, name, level, teacher_id, invite_token) VALUES (?,?,?,?,?,?)`)
    .run(id, p.orgId, p.name, p.level, p.teacherId, inviteToken());
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

/** Parent self-join (§7.5): create a parent-sourced student with a fresh recap token. */
export function addParentStudent(
  sqlite: DB,
  p: { classId: string; name: string; photoKey: string | null },
): { id: string; recapToken: string } {
  const id = `s-${nanoid(10)}`;
  const recapToken = nanoid(24);
  sqlite
    .prepare(`INSERT INTO students (id, class_id, name, photo_url, source, recap_token) VALUES (?,?,?,?,?,?)`)
    .run(id, p.classId, p.name, p.photoKey, 'parent', recapToken);
  return { id, recapToken };
}

/** Hard-delete a student and all ledger rows referencing them (single transaction). */
export function deleteStudent(sqlite: DB, studentId: string): void {
  const tx = sqlite.transaction((sid: string) => {
    sqlite.prepare(`DELETE FROM class_group_memberships WHERE student_id=?`).run(sid);
    sqlite.prepare(`DELETE FROM session_memberships WHERE student_id=?`).run(sid);
    sqlite.prepare(`DELETE FROM score_events WHERE target_type='student' AND target_id=?`).run(sid);
    sqlite.prepare(`DELETE FROM check_records WHERE student_id=?`).run(sid);
    sqlite.prepare(`DELETE FROM students WHERE id=?`).run(sid);
  });
  tx(studentId);
}

/**
 * Replace a class's entire default grouping (PRD "save = update default group").
 * Idempotent: rebuilds class_groups + memberships from `groups`; any student not
 * listed in a group becomes ungrouped. Members are filtered to the class roster.
 */
export function saveGrouping(sqlite: DB, classId: string, groups: GroupInput[]): void {
  const tx = sqlite.transaction(() => {
    const roster = new Set(
      (sqlite.prepare(`SELECT id FROM students WHERE class_id=?`).all(classId) as any[]).map((r) => r.id),
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
