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
