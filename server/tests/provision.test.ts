import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DDL } from '../src/db/ddl.js';

// Provisioning a clean production database: no seed, no fixtures. The env must
// be set before the first import of db/client (read at module-load time), so
// everything is imported dynamically from beforeAll — same rule as helpers.ts.
let provision: typeof import('../src/db/provision.js');
let sqlite: Database.Database;

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isAdminOf = (username: string) =>
  (sqlite.prepare(`SELECT is_admin FROM teachers WHERE username=?`).get(username) as any).is_admin;

beforeAll(async () => {
  process.env.NCE_DB_PATH = join(mkdtempSync(join(tmpdir(), 'nce-provision-')), 'app.db');
  process.env.NCE_UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'nce-provision-uploads-'));
  process.env.AUTH_SECRET = 'test-secret';
  provision = await import('../src/db/provision.js');
  ({ sqlite } = await import('../src/db/client.js'));
});

describe('migrate', () => {
  it('creates the full schema on an empty database and is idempotent', () => {
    provision.migrate(sqlite);
    provision.migrate(sqlite); // second run must be a no-op, not an error

    const tables = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r: any) => r.name);
    for (const t of [
      'organizations',
      'teachers',
      'credentials',
      'classes',
      'students',
      'class_groups',
      'class_group_memberships',
      'class_sessions',
      'session_groups',
      'session_memberships',
      'score_events',
      'check_records',
      'wechat_accounts',
      'student_wechat_bindings',
      'class_invites',
      'join_requests',
      'class_schedules',
      'schedule_lessons',
      'billing_batches',
      'invoices',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('adds teachers.is_admin to a pre-admin database: default 0, no backfill, idempotent', () => {
    const old = new Database(':memory:');
    old.exec(
      `CREATE TABLE teachers (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL,
         username TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'teacher',
         created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    );
    old
      .prepare(`INSERT INTO teachers (id, org_id, name, username, role) VALUES ('t-boss','o1','老板','boss','owner')`)
      .run();
    provision.migrate(old);
    provision.migrate(old);
    // even an owner stays a non-admin — admins are only ever granted by the set-admin CLI
    expect(old.prepare(`SELECT is_admin FROM teachers WHERE id='t-boss'`).get()).toEqual({ is_admin: 0 });
    old.prepare(`INSERT INTO teachers (id, org_id, name, username) VALUES ('t-new','o1','新人','newbie')`).run();
    expect(old.prepare(`SELECT is_admin FROM teachers WHERE id='t-new'`).get()).toEqual({ is_admin: 0 });
    old.close();
  });

  it('adds classes.is_archived to a pre-archive database: existing classes stay unarchived, idempotent', () => {
    const old = new Database(':memory:');
    old.exec(
      `CREATE TABLE classes (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, notes TEXT, teacher_id TEXT,
         textbook TEXT, homework_template TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    );
    old.prepare(`INSERT INTO classes (id, org_id, name) VALUES ('c-old','o1','老班')`).run();
    provision.migrate(old);
    provision.migrate(old);
    const col = (old.prepare(`PRAGMA table_info(classes)`).all() as any[]).find((c) => c.name === 'is_archived');
    expect(col).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });
    expect(old.prepare(`SELECT is_archived FROM classes WHERE id='c-old'`).get()).toEqual({ is_archived: 0 });
    old.close();
  });
});

// 教材 columns (classes.textbook / class_sessions.review_book) hold string keys
// ('1'-'4', 'starterA', 'starterB') in TEXT columns — never relying on SQLite
// type affinity. Databases from before 青少版 created them INTEGER and must be
// converted in place.
describe('migrate: 教材 columns are TEXT', () => {
  const columns = (db: Database.Database, table: string) =>
    db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[];
  const colType = (db: Database.Database, table: string, col: string) =>
    columns(db, table).find((c) => c.name === col)?.type;

  it('creates both as TEXT on a fresh database', () => {
    const db = new Database(':memory:');
    provision.migrate(db);
    expect(colType(db, 'classes', 'textbook')).toBe('TEXT');
    expect(colType(db, 'class_sessions', 'review_book')).toBe('TEXT');
    db.close();
  });

  it('adds both as TEXT on a pre-作业机制 database that lacks them', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE classes (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, teacher_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE class_sessions (id TEXT PRIMARY KEY, class_id TEXT NOT NULL, teacher_id TEXT,
        date TEXT NOT NULL, lesson_number INTEGER, lesson_title TEXT, status TEXT NOT NULL DEFAULT 'ended',
        planned_duration_min INTEGER NOT NULL DEFAULT 120, started_at TEXT, ended_at TEXT,
        client_session_id TEXT UNIQUE);
    `);
    provision.migrate(db);
    expect(colType(db, 'classes', 'textbook')).toBe('TEXT');
    expect(colType(db, 'class_sessions', 'review_book')).toBe('TEXT');
    db.close();
  });

  it('converts legacy INTEGER columns in place, keeping every row and column, idempotently', () => {
    const legacyDdl = DDL.replace('textbook TEXT', 'textbook INTEGER').replace(
      'review_book TEXT',
      'review_book INTEGER',
    );
    expect(legacyDdl).not.toBe(DDL);
    const db = new Database(':memory:');
    db.exec(legacyDdl);
    db.prepare(
      `INSERT INTO classes (id, org_id, name, teacher_id, textbook, homework_template) VALUES (?,?,?,?,?,?)`,
    ).run('c1', 'o1', '一班', 't1', 1, '- 背L{lesson_number}');
    db.prepare(`INSERT INTO classes (id, org_id, name) VALUES (?,?,?)`).run('c2', 'o1', '二班');
    db.prepare(
      `INSERT INTO class_sessions (id, class_id, date, lesson_number, homework_content, review_book, review_lesson)
       VALUES (?,?,?,?,?,?,?)`,
    ).run('s1', 'c1', '2026-06-01', 7, '作业', 2, 7);
    expect(colType(db, 'classes', 'textbook')).toBe('INTEGER');

    provision.migrate(db);
    provision.migrate(db); // already TEXT → no-op

    expect(colType(db, 'classes', 'textbook')).toBe('TEXT');
    expect(colType(db, 'class_sessions', 'review_book')).toBe('TEXT');
    expect(
      db
        .prepare(
          `SELECT id, name, teacher_id, textbook, typeof(textbook) AS t, homework_template FROM classes ORDER BY id`,
        )
        .all(),
    ).toEqual([
      { id: 'c1', name: '一班', teacher_id: 't1', textbook: '1', t: 'text', homework_template: '- 背L{lesson_number}' },
      { id: 'c2', name: '二班', teacher_id: null, textbook: null, t: 'null', homework_template: null },
    ]);
    expect(
      db
        .prepare(
          `SELECT id, lesson_number, homework_content, review_book, typeof(review_book) AS t, review_lesson FROM class_sessions`,
        )
        .get(),
    ).toEqual({ id: 's1', lesson_number: 7, homework_content: '作业', review_book: '2', t: 'text', review_lesson: 7 });

    // same column set as a fresh database (no leftover temp column, nothing dropped)
    const fresh = new Database(':memory:');
    provision.migrate(fresh);
    for (const table of ['classes', 'class_sessions']) {
      const names = (d: Database.Database) =>
        columns(d, table)
          .map((c) => c.name)
          .sort();
      expect(names(db)).toEqual(names(fresh));
    }
    fresh.close();
    db.close();
  });
});

describe('createTeacher', () => {
  it('creates org + teacher + password credential that can log in', async () => {
    const { orgId, teacherId } = provision.createTeacher(sqlite, {
      org: '晨光英语',
      name: '王莉',
      username: 'wangli',
      password: 'real-pass-1',
    });
    expect(orgId).toBeTruthy();
    expect(teacherId).toBeTruthy();

    const { createApp } = await import('../src/app.js');
    const res = await request(createApp())
      .post('/api/auth/login')
      .send({ username: 'wangli', password: 'real-pass-1' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toContain('nce_session=');
  });

  it('reuses an existing organization by name', () => {
    const first = provision.createTeacher(sqlite, {
      org: '晨光英语',
      name: '陈晓',
      username: 'chenxiao',
      password: 'real-pass-2',
    });
    const second = provision.createTeacher(sqlite, {
      org: '别校',
      name: '外老师',
      username: 'waiguo',
      password: 'real-pass-3',
    });
    const wangli = sqlite.prepare(`SELECT org_id FROM teachers WHERE username='wangli'`).get() as any;
    expect(first.orgId).toBe(wangli.org_id);
    expect(second.orgId).not.toBe(wangli.org_id);
  });

  it('creates an admin only when isAdmin is set (default: not an admin)', () => {
    provision.createTeacher(sqlite, {
      org: '晨光英语',
      name: '管理员',
      username: 'boss',
      password: 'boss-pass-1',
      isAdmin: true,
    });
    expect(isAdminOf('boss')).toBe(1);
    expect(isAdminOf('wangli')).toBe(0);
  });

  it('rejects a duplicate username without touching the database', () => {
    const before = sqlite.prepare(`SELECT count(*) n FROM teachers`).get() as any;
    expect(() =>
      provision.createTeacher(sqlite, {
        org: '晨光英语',
        name: '假王莉',
        username: 'wangli',
        password: 'whatever',
      }),
    ).toThrow(/username/);
    const after = sqlite.prepare(`SELECT count(*) n FROM teachers`).get() as any;
    expect(after.n).toBe(before.n);
  });
});

async function login(username: string, password: string) {
  const { createApp } = await import('../src/app.js');
  return request(createApp()).post('/api/auth/login').send({ username, password });
}

describe('resetPassword', () => {
  it('replaces the password: old one stops working, new one logs in, other teachers untouched', async () => {
    provision.resetPassword(sqlite, { username: 'wangli', password: 'brand-new-1' });
    expect((await login('wangli', 'real-pass-1')).status).toBe(401);
    expect((await login('wangli', 'brand-new-1')).status).toBe(200);
    expect((await login('chenxiao', 'real-pass-2')).status).toBe(200);
  });

  it('rejects an unknown username', () => {
    expect(() => provision.resetPassword(sqlite, { username: 'nobody', password: 'whatever-1' })).toThrow(
      /username not found/,
    );
  });

  it('rejects a password shorter than 6 characters and keeps the old one', async () => {
    expect(() => provision.resetPassword(sqlite, { username: 'wangli', password: '12345' })).toThrow(/at least 6/);
    expect((await login('wangli', 'brand-new-1')).status).toBe(200);
  });

  it('creates the password credential when the teacher has none', async () => {
    const t = sqlite.prepare(`SELECT id FROM teachers WHERE username='waiguo'`).get() as any;
    sqlite.prepare(`DELETE FROM credentials WHERE teacher_id=? AND provider='password'`).run(t.id);
    expect((await login('waiguo', 'real-pass-3')).status).toBe(401);

    provision.resetPassword(sqlite, { username: 'waiguo', password: 'revived-pass' });
    expect((await login('waiguo', 'revived-pass')).status).toBe(200);
  });
});

// The real script against the same temp database (NCE_DB_PATH is inherited);
// the new password arrives on stdin as two lines, like an operator typing it.
describe('reset-password CLI', { timeout: 30_000 }, () => {
  const runCli = (args: string[], input: string) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'src/db/reset-password.ts', ...args], {
      cwd: serverDir,
      input,
      encoding: 'utf8',
    });

  it('resets the password read from stdin (entered twice)', async () => {
    const r = runCli(['--username', 'chenxiao'], 'cli-pass-1\ncli-pass-1\n');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('password reset: chenxiao');
    expect(r.stdout).not.toContain('cli-pass-1');
    expect((await login('chenxiao', 'cli-pass-1')).status).toBe(200);
  });

  it('refuses when the two entries differ or input ends early, leaving the password unchanged', async () => {
    const mismatch = runCli(['--username', 'chenxiao'], 'aaaaaa-1\nbbbbbb-2\n');
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('passwords do not match');

    const early = runCli(['--username', 'chenxiao'], 'only-once\n');
    expect(early.status).toBe(1);
    expect(early.stderr).toContain('aborted');

    const short = runCli(['--username', 'chenxiao'], '12345\n12345\n');
    expect(short.status).toBe(1);
    expect(short.stderr).toContain('at least 6');

    expect((await login('chenxiao', 'cli-pass-1')).status).toBe(200);
  });

  it('lists the existing usernames when --username is missing or unknown', () => {
    for (const args of [[], ['--username', 'nobody']]) {
      const r = runCli(args, '');
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('Usage:');
      expect(r.stderr).toContain('wangli');
      expect(r.stderr).toContain('chenxiao');
    }
    expect(runCli(['--username', 'nobody'], '').stderr).toContain('username not found: nobody');
  });
});

describe('setAdmin', () => {
  it('grants and revokes admin by username, returning the teacher id', () => {
    const t = sqlite.prepare(`SELECT id FROM teachers WHERE username='chenxiao'`).get() as any;
    expect(provision.setAdmin(sqlite, { username: 'chenxiao', isAdmin: true })).toEqual({ teacherId: t.id });
    expect(isAdminOf('chenxiao')).toBe(1);
    expect(isAdminOf('wangli')).toBe(0); // nobody else touched

    provision.setAdmin(sqlite, { username: 'chenxiao', isAdmin: false });
    expect(isAdminOf('chenxiao')).toBe(0);
  });

  it('rejects an unknown username', () => {
    expect(() => provision.setAdmin(sqlite, { username: 'nobody', isAdmin: true })).toThrow(/username not found/);
  });
});

describe('set-admin CLI', { timeout: 30_000 }, () => {
  const runCli = (args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'src/db/set-admin.ts', ...args], {
      cwd: serverDir,
      encoding: 'utf8',
    });

  it('grants admin, and --revoke takes it away', () => {
    const grant = runCli(['--username', 'waiguo']);
    expect(grant.stderr).toBe('');
    expect(grant.status).toBe(0);
    expect(grant.stdout).toContain('admin granted: waiguo');
    expect(isAdminOf('waiguo')).toBe(1);

    const revoke = runCli(['--username', 'waiguo', '--revoke']);
    expect(revoke.stderr).toBe('');
    expect(revoke.status).toBe(0);
    expect(revoke.stdout).toContain('admin revoked: waiguo');
    expect(isAdminOf('waiguo')).toBe(0);
  });

  it('lists the usernames with their admin mark when --username is missing or unknown', () => {
    for (const args of [[], ['--revoke'], ['--username', 'nobody']]) {
      const r = runCli(args);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('Usage:');
      const line = (u: string) => r.stderr.split('\n').find((l) => l.trim().startsWith(`${u} `));
      expect(line('boss')).toContain('[admin]');
      expect(line('chenxiao')).toBeDefined();
      expect(line('chenxiao')).not.toContain('[admin]');
    }
    expect(runCli(['--username', 'nobody']).stderr).toContain('username not found: nobody');
    expect(isAdminOf('boss')).toBe(1); // a failed run changes nothing
  });
});

describe('create-teacher CLI', { timeout: 30_000 }, () => {
  it('provisions a first admin in one step with --admin', async () => {
    const r = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'src/db/create-teacher.ts',
        '--org',
        '晨光英语',
        '--name',
        '首位管理员',
        '--username',
        'root1',
        '--password',
        'root-pass-1',
        '--admin',
      ],
      { cwd: serverDir, encoding: 'utf8' },
    );
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(isAdminOf('root1')).toBe(1);
    expect((await login('root1', 'root-pass-1')).status).toBe(200);
  });
});
