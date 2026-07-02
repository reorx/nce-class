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
