import type DatabaseType from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
