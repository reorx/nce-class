// Raw DDL kept in sync with schema.ts. Executed by the seed so `db:reset` is
// fully self-contained (no migration step needed for the M1 demo). Real
// migrations still live under drizzle/ via drizzle-kit for production use.
export const DDL = `
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'teacher',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL, provider TEXT NOT NULL,
  secret TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL,
  level TEXT, teacher_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY, class_id TEXT NOT NULL, name TEXT NOT NULL,
  photo_url TEXT, source TEXT NOT NULL, recap_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS class_groups (
  id TEXT PRIMARY KEY, class_id TEXT NOT NULL, name TEXT NOT NULL,
  emoji TEXT, order_index INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS class_group_memberships (
  id TEXT PRIMARY KEY, class_group_id TEXT NOT NULL, student_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS class_sessions (
  id TEXT PRIMARY KEY, class_id TEXT NOT NULL, teacher_id TEXT,
  date TEXT NOT NULL, lesson_number INTEGER, lesson_title TEXT,
  status TEXT NOT NULL DEFAULT 'ended',
  planned_duration_min INTEGER NOT NULL DEFAULT 120,
  started_at TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS session_groups (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, name TEXT NOT NULL,
  emoji TEXT, order_index INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS session_memberships (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, student_id TEXT NOT NULL,
  session_group_id TEXT, attendance TEXT NOT NULL DEFAULT 'present'
);
CREATE TABLE IF NOT EXISTS score_events (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, target_type TEXT NOT NULL,
  target_id TEXT NOT NULL, session_group_id TEXT, delta INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), created_by TEXT
);
CREATE TABLE IF NOT EXISTS check_records (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, student_id TEXT NOT NULL,
  type TEXT NOT NULL, status TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
