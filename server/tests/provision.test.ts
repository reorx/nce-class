import type DatabaseType from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

// Provisioning a clean production database: no seed, no fixtures. The env must
// be set before the first import of db/client (read at module-load time), so
// everything is imported dynamically from beforeAll — same rule as helpers.ts.
let provision: typeof import('../src/db/provision.js');
let sqlite: DatabaseType.Database;

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
  const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
