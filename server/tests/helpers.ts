import type DatabaseType from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import { hashPassword } from '../src/auth/password.js';
import { DDL } from '../src/db/ddl.js';

type DB = DatabaseType.Database;

// Boots the real app against a throwaway SQLite file. Must run before any other
// import of db/client (env is read at client module-load time), so callers use
// this from beforeAll and never statically import app/client themselves.
export async function setupTestApp(): Promise<{ app: Express; sqlite: DB; reseed: () => void }> {
  process.env.NCE_DB_PATH = join(mkdtempSync(join(tmpdir(), 'nce-test-')), 'app.db');
  process.env.AUTH_SECRET = 'test-secret';
  const { sqlite } = await import('../src/db/client.js');
  sqlite.exec(DDL);
  seed(sqlite);
  const { createApp } = await import('../src/app.js');
  return { app: createApp(), sqlite, reseed: () => reseed(sqlite) };
}

const TABLES = [
  'check_records',
  'score_events',
  'session_memberships',
  'session_groups',
  'class_sessions',
  'class_group_memberships',
  'class_groups',
  'students',
  'classes',
  'credentials',
  'teachers',
  'organizations',
];

function reseed(sqlite: DB) {
  for (const t of TABLES) sqlite.exec(`DELETE FROM ${t}`);
  seed(sqlite);
}

// Two orgs so we can assert cross-org isolation; c1 mirrors the shape the
// endpoints care about (grouped + ungrouped students, one ended session).
function seed(sqlite: DB) {
  const run = (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...args);

  run(`INSERT INTO organizations (id, name) VALUES ('org-1','晨光英语'),('org-2','别校')`);

  const teacher = (id: string, org: string, name: string, username: string, role: string) => {
    run(`INSERT INTO teachers (id, org_id, name, username, role) VALUES (?,?,?,?,?)`, id, org, name, username, role);
    run(
      `INSERT INTO credentials (id, teacher_id, provider, secret) VALUES (?,?,'password',?)`,
      `cred-${id}`,
      id,
      hashPassword('demo1234'),
    );
  };
  teacher('t-wangli', 'org-1', '王莉', 'wangli', 'owner');
  teacher('t-out', 'org-2', '外老师', 'waiguo', 'teacher');

  run(
    `INSERT INTO classes (id, org_id, name, level, teacher_id, created_at) VALUES ('c1','org-1','三年级A班','新概念二册','t-wangli','2026-06-01 08:00:00')`,
  );
  run(
    `INSERT INTO classes (id, org_id, name, level, teacher_id, created_at) VALUES ('c-out','org-2','外班',NULL,'t-out','2026-06-01 08:00:01')`,
  );

  const student = (id: string, cls: string, name: string, source: string, i: number) =>
    run(
      `INSERT INTO students (id, class_id, name, photo_url, source, recap_token, created_at) VALUES (?,?,?,NULL,?,?,?)`,
      id,
      cls,
      name,
      source,
      `tok-${id}`,
      `2026-05-01 08:00:0${i}`,
    );
  student('s1', 'c1', '小明', 'parent', 1);
  student('s2', 'c1', '小红', 'teacher', 2);
  student('s3', 'c1', '小刚', 'teacher', 3);
  student('s4', 'c1', '浩浩', 'parent', 4);
  student('so1', 'c-out', '外生', 'parent', 1);

  run(
    `INSERT INTO class_groups (id, class_id, name, emoji, order_index) VALUES ('g1','c1','第1组','🦁',0),('g2','c1','第2组','🐯',1)`,
  );
  const member = (gid: string, sid: string) =>
    run(
      `INSERT INTO class_group_memberships (id, class_group_id, student_id) VALUES (?,?,?)`,
      `m-${gid}-${sid}`,
      gid,
      sid,
    );
  member('g1', 's1');
  member('g1', 's2');
  member('g2', 's3'); // s4 ungrouped

  // one ended session with a score ledger that yields deterministic recap
  run(
    `INSERT INTO class_sessions (id, class_id, teacher_id, date, lesson_number, lesson_title, status, planned_duration_min, started_at, ended_at)
     VALUES ('sess1','c1','t-wangli','2026-06-26',7,'Too late','ended',120,'2026-06-26 19:00:00','2026-06-26 20:58:00')`,
  );
  run(
    `INSERT INTO session_groups (id, session_id, name, emoji, order_index) VALUES ('sg1','sess1','第1组','🦁',0),('sg2','sess1','第2组','🐯',1)`,
  );
  const smem = (sid: string, sgid: string | null, att: string) =>
    run(
      `INSERT INTO session_memberships (id, session_id, student_id, session_group_id, attendance) VALUES (?,?,?,?,?)`,
      `sm-${sid}`,
      'sess1',
      sid,
      sgid,
      att,
    );
  smem('s1', 'sg1', 'present');
  smem('s2', 'sg1', 'present');
  smem('s3', 'sg2', 'present');
  smem('s4', null, 'absent');

  let ev = 0;
  const event = (tt: string, tid: string, sgid: string | null, delta: number) =>
    run(
      `INSERT INTO score_events (id, session_id, target_type, target_id, session_group_id, delta, created_by) VALUES (?,?,?,?,?,?, 't-wangli')`,
      `e${ev++}`,
      'sess1',
      tt,
      tid,
      sgid,
      delta,
    );
  event('student', 's1', 'sg1', 1);
  event('student', 's1', 'sg1', 1); // 小明 net +2 → star
  event('student', 's2', 'sg1', 1); // 小红 net +1
  event('student', 's3', 'sg2', 1);
  event('student', 's3', 'sg2', -1); // 小刚 net 0, has a −1 → warned
  event('group', 'sg1', 'sg1', 1); // 第1组 +1 (group-level)
  // group sg1 nested score = s1(2)+s2(1)+group(1) = 4 ; sg2 = s3(0) = 0
}
