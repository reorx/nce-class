import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ---- Organization (school) — data-isolation unit; M1 runs a single one, but every model carries orgId ----
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// ---- Teacher — self-built auth (username + password); identity decoupled from credentials ----
export const teachers = sqliteTable('teachers', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  username: text('username').notNull().unique(),
  role: text('role').notNull().default('teacher'), // owner | teacher
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// ---- Credential — reserved: decouple login providers (password now, wechat later) ----
export const credentials = sqliteTable('credentials', {
  id: text('id').primaryKey(),
  teacherId: text('teacher_id')
    .notNull()
    .references(() => teachers.id),
  provider: text('provider').notNull(), // password | wechat
  secret: text('secret'), // password: "salt:hash"; wechat: openid
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// ---- Class ----
export const classes = sqliteTable('classes', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  level: text('level'), // 新概念二册 etc. (optional grade / book)
  teacherId: text('teacher_id').references(() => teachers.id), // 负责老师
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// ---- Student ----
export const students = sqliteTable('students', {
  id: text('id').primaryKey(),
  classId: text('class_id')
    .notNull()
    .references(() => classes.id),
  name: text('name').notNull(),
  photoUrl: text('photo_url'),
  source: text('source').notNull(), // parent | teacher
  recapToken: text('recap_token').notNull().unique(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// ---- ClassGroup — the class's single default grouping ----
export const classGroups = sqliteTable('class_groups', {
  id: text('id').primaryKey(),
  classId: text('class_id')
    .notNull()
    .references(() => classes.id),
  name: text('name').notNull(),
  emoji: text('emoji'),
  orderIndex: integer('order_index').notNull().default(0),
});

export const classGroupMemberships = sqliteTable('class_group_memberships', {
  id: text('id').primaryKey(),
  classGroupId: text('class_group_id')
    .notNull()
    .references(() => classGroups.id),
  studentId: text('student_id')
    .notNull()
    .references(() => students.id),
});

// ---- ClassSession — one "start class" session ----
export const classSessions = sqliteTable('class_sessions', {
  id: text('id').primaryKey(),
  classId: text('class_id')
    .notNull()
    .references(() => classes.id),
  teacherId: text('teacher_id').references(() => teachers.id),
  date: text('date').notNull(), // YYYY-MM-DD
  lessonNumber: integer('lesson_number'),
  lessonTitle: text('lesson_title'),
  status: text('status').notNull().default('ended'), // ongoing | ended
  plannedDurationMin: integer('planned_duration_min').notNull().default(120),
  startedAt: text('started_at'),
  endedAt: text('ended_at'),
  // Idempotency key for the offline-first end-class commit (decision 10): the
  // client's local session id, so a retried submit returns the existing row
  // instead of double-inserting. Null for legacy/seeded sessions.
  clientSessionId: text('client_session_id').unique(),
});

// ---- SessionGroup — snapshot of the default grouping at start; adjustable mid-class ----
export const sessionGroups = sqliteTable('session_groups', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => classSessions.id),
  name: text('name').notNull(),
  emoji: text('emoji'),
  orderIndex: integer('order_index').notNull().default(0),
});

export const sessionMemberships = sqliteTable('session_memberships', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => classSessions.id),
  studentId: text('student_id')
    .notNull()
    .references(() => students.id),
  sessionGroupId: text('session_group_id').references(() => sessionGroups.id),
  attendance: text('attendance').notNull().default('present'), // present | absent
});

// ---- ScoreEvent — ledger; single source of truth for all derived scores ----
export const scoreEvents = sqliteTable('score_events', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => classSessions.id),
  targetType: text('target_type').notNull(), // group | student
  targetId: text('target_id').notNull(),
  sessionGroupId: text('session_group_id').references(() => sessionGroups.id),
  delta: integer('delta').notNull(), // +1 or -1
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  createdBy: text('created_by'),
});

// ---- CheckRecord — recitation / homework qualitative labels ----
export const checkRecords = sqliteTable('check_records', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => classSessions.id),
  studentId: text('student_id')
    .notNull()
    .references(() => students.id),
  type: text('type').notNull(), // recitation | homework
  status: text('status').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});
