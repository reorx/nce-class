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
  // 作业机制: 教材册数 + 作业模板 on classes, 作业布置 fields on class_sessions.
  if (!classCols.some((c) => c.name === 'textbook')) {
    sqlite.exec(`ALTER TABLE classes ADD COLUMN textbook INTEGER`);
  }
  if (!classCols.some((c) => c.name === 'homework_template')) {
    sqlite.exec(`ALTER TABLE classes ADD COLUMN homework_template TEXT`);
  }
  const sessionCols = sqlite.prepare(`PRAGMA table_info(class_sessions)`).all() as { name: string }[];
  if (!sessionCols.some((c) => c.name === 'homework_content')) {
    sqlite.exec(`ALTER TABLE class_sessions ADD COLUMN homework_content TEXT`);
  }
  if (!sessionCols.some((c) => c.name === 'review_book')) {
    sqlite.exec(`ALTER TABLE class_sessions ADD COLUMN review_book INTEGER`);
  }
  if (!sessionCols.some((c) => c.name === 'review_lesson')) {
    sqlite.exec(`ALTER TABLE class_sessions ADD COLUMN review_lesson INTEGER`);
  }
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
}

/** Provision a real account on a clean database: org (by name, created if missing) + teacher + password credential. */
export function createTeacher(
  sqlite: DB,
  p: { org: string; name: string; username: string; password: string; role?: string },
): { orgId: string; teacherId: string } {
  const taken = sqlite.prepare(`SELECT id FROM teachers WHERE username = ?`).get(p.username);
  if (taken) throw new Error(`username already taken: ${p.username}`);

  const tx = sqlite.transaction(() => {
    const org = sqlite.prepare(`SELECT id FROM organizations WHERE name = ?`).get(p.org) as { id: string } | undefined;
    const orgId = org?.id ?? `org-${nanoid(10)}`;
    if (!org) sqlite.prepare(`INSERT INTO organizations (id, name) VALUES (?, ?)`).run(orgId, p.org);

    const teacherId = `t-${nanoid(10)}`;
    sqlite
      .prepare(`INSERT INTO teachers (id, org_id, name, username, role) VALUES (?,?,?,?,?)`)
      .run(teacherId, orgId, p.name, p.username, p.role ?? 'owner');
    sqlite
      .prepare(`INSERT INTO credentials (id, teacher_id, provider, secret) VALUES (?,?,'password',?)`)
      .run(`cred-${nanoid(10)}`, teacherId, hashPassword(p.password));
    return { orgId, teacherId };
  });
  return tx();
}
