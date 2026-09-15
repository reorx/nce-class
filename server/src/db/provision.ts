import type DatabaseType from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { hashPassword } from '../auth/password.js';
import { DDL } from './ddl.js';

type DB = DatabaseType.Database;

// "Migration" for now = re-running the idempotent DDL (all CREATE TABLE IF NOT
// EXISTS). ALTER-style schema changes must be added here by hand until we adopt
// drizzle-kit migrations.
export function migrate(sqlite: DB): void {
  sqlite.exec(DDL);
  // Pre-status databases: CREATE TABLE IF NOT EXISTS won't add the column.
  const studentCols = sqlite.prepare(`PRAGMA table_info(students)`).all() as { name: string }[];
  if (!studentCols.some((c) => c.name === 'status')) {
    sqlite.exec(`ALTER TABLE students ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }
  // Pre-notes databases: 班级资源 markdown column on classes.
  const classCols = sqlite.prepare(`PRAGMA table_info(classes)`).all() as { name: string }[];
  if (!classCols.some((c) => c.name === 'notes')) {
    sqlite.exec(`ALTER TABLE classes ADD COLUMN notes TEXT`);
  }
  // 课程级别 field removed 2026-07-05 — drop the leftover column on old databases.
  if (classCols.some((c) => c.name === 'level')) {
    sqlite.exec(`ALTER TABLE classes DROP COLUMN level`);
  }
  // 作业机制: 教材 + 作业模板 on classes, 作业布置 fields on class_sessions.
  if (!classCols.some((c) => c.name === 'textbook')) {
    sqlite.exec(`ALTER TABLE classes ADD COLUMN textbook TEXT`);
  }
  if (!classCols.some((c) => c.name === 'homework_template')) {
    sqlite.exec(`ALTER TABLE classes ADD COLUMN homework_template TEXT`);
  }
  // 班级归档 flag; existing classes stay unarchived.
  if (!classCols.some((c) => c.name === 'is_archived')) {
    sqlite.exec(`ALTER TABLE classes ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0`);
  }
  const sessionCols = sqlite.prepare(`PRAGMA table_info(class_sessions)`).all() as { name: string }[];
  if (!sessionCols.some((c) => c.name === 'homework_content')) {
    sqlite.exec(`ALTER TABLE class_sessions ADD COLUMN homework_content TEXT`);
  }
  if (!sessionCols.some((c) => c.name === 'review_book')) {
    sqlite.exec(`ALTER TABLE class_sessions ADD COLUMN review_book TEXT`);
  }
  if (!sessionCols.some((c) => c.name === 'review_lesson')) {
    sqlite.exec(`ALTER TABLE class_sessions ADD COLUMN review_lesson INTEGER`);
  }
  // 教材 keys are strings ('1'-'4' 第一~四册, 'starterA'/'starterB' 青少版A/B) in TEXT
  // columns; databases from before 青少版 declared both columns INTEGER.
  convertColumnToText(sqlite, 'classes', 'textbook');
  convertColumnToText(sqlite, 'class_sessions', 'review_book');
  // 收银台: 课程次数覆盖 (NULL = 跟随排班节数) on billing batches.
  const batchCols = sqlite.prepare(`PRAGMA table_info(billing_batches)`).all() as { name: string }[];
  if (!batchCols.some((c) => c.name === 'lesson_count_override')) {
    sqlite.exec(`ALTER TABLE billing_batches ADD COLUMN lesson_count_override INTEGER`);
  }
  // 考勤 corrections: 补课 flag on session memberships.
  const memberCols = sqlite.prepare(`PRAGMA table_info(session_memberships)`).all() as { name: string }[];
  if (!memberCols.some((c) => c.name === 'made_up')) {
    sqlite.exec(`ALTER TABLE session_memberships ADD COLUMN made_up INTEGER NOT NULL DEFAULT 0`);
  }
  // 管理员 flag. No backfill on purpose: after deploy nobody is an admin until the
  // set-admin CLI grants it (an existing owner is never promoted implicitly).
  const teacherCols = sqlite.prepare(`PRAGMA table_info(teachers)`).all() as { name: string }[];
  if (!teacherCols.some((c) => c.name === 'is_admin')) {
    sqlite.exec(`ALTER TABLE teachers ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
  }
}

/**
 * Re-declare an INTEGER column as TEXT in place (SQLite has no ALTER COLUMN TYPE):
 * add a TEXT twin, copy with CAST, drop the original, rename the twin back — all
 * in one transaction. No-op unless the column is currently declared INTEGER.
 */
function convertColumnToText(sqlite: DB, table: string, column: string): void {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[];
  if (cols.find((c) => c.name === column)?.type !== 'INTEGER') return;
  const twin = `${column}__text`;
  sqlite.transaction(() => {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${twin} TEXT`);
    sqlite.exec(`UPDATE ${table} SET ${twin} = CAST(${column} AS TEXT)`);
    sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    sqlite.exec(`ALTER TABLE ${table} RENAME COLUMN ${twin} TO ${column}`);
  })();
}

/**
 * Provision a real account on a clean database: org (by name, created if missing) + teacher + password credential.
 * `isAdmin` makes it an admin in the same step (the first account of a fresh deploy).
 */
export function createTeacher(
  sqlite: DB,
  p: { org: string; name: string; username: string; password: string; role?: string; isAdmin?: boolean },
): { orgId: string; teacherId: string } {
  const taken = sqlite.prepare(`SELECT id FROM teachers WHERE username = ?`).get(p.username);
  if (taken) throw new Error(`username already taken: ${p.username}`);

  const tx = sqlite.transaction(() => {
    const org = sqlite.prepare(`SELECT id FROM organizations WHERE name = ?`).get(p.org) as { id: string } | undefined;
    const orgId = org?.id ?? `org-${nanoid(10)}`;
    if (!org) sqlite.prepare(`INSERT INTO organizations (id, name) VALUES (?, ?)`).run(orgId, p.org);

    const teacherId = `t-${nanoid(10)}`;
    sqlite
      .prepare(`INSERT INTO teachers (id, org_id, name, username, role, is_admin) VALUES (?,?,?,?,?,?)`)
      .run(teacherId, orgId, p.name, p.username, p.role ?? 'owner', p.isAdmin ? 1 : 0);
    sqlite
      .prepare(`INSERT INTO credentials (id, teacher_id, provider, secret) VALUES (?,?,'password',?)`)
      .run(`cred-${nanoid(10)}`, teacherId, hashPassword(p.password));
    return { orgId, teacherId };
  });
  return tx();
}

export const MIN_PASSWORD_LENGTH = 6; // same rule as the teachers API

/** Ops reset for a forgotten password (no login needed, run on the server): overwrite the teacher's password credential, creating it if missing. */
export function resetPassword(sqlite: DB, p: { username: string; password: string }): { teacherId: string } {
  if (p.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const teacher = sqlite.prepare(`SELECT id FROM teachers WHERE username = ?`).get(p.username) as
    | { id: string }
    | undefined;
  if (!teacher) throw new Error(`username not found: ${p.username}`);

  const secret = hashPassword(p.password);
  const tx = sqlite.transaction(() => {
    const updated = sqlite
      .prepare(`UPDATE credentials SET secret=? WHERE teacher_id=? AND provider='password'`)
      .run(secret, teacher.id);
    if (updated.changes === 0) {
      sqlite
        .prepare(`INSERT INTO credentials (id, teacher_id, provider, secret) VALUES (?,?,'password',?)`)
        .run(`cred-${nanoid(10)}`, teacher.id, secret);
    }
  });
  tx();
  return { teacherId: teacher.id };
}

/** Grant or revoke 管理员 by username — the only way in (no page can promote). Bites on that teacher's next request. */
export function setAdmin(sqlite: DB, p: { username: string; isAdmin: boolean }): { teacherId: string } {
  const teacher = sqlite.prepare(`SELECT id FROM teachers WHERE username = ?`).get(p.username) as
    | { id: string }
    | undefined;
  if (!teacher) throw new Error(`username not found: ${p.username}`);
  sqlite.prepare(`UPDATE teachers SET is_admin = ? WHERE id = ?`).run(p.isAdmin ? 1 : 0, teacher.id);
  return { teacherId: teacher.id };
}
