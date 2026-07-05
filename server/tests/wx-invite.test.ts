import type DatabaseType from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, wxLogin } from './helpers.js';

// 邀请与注册：老师在小程序生成一次性带过期 token 的邀请 → 家长通过分享卡片
// 打开预览 → 传照片 → 提交 join_request（不建 student）。

let app: Express;
let sqlite: DatabaseType.Database;
let reseed: () => void;

beforeAll(async () => {
  ({ app, sqlite, reseed } = await setupTestApp());
});
beforeEach(() => reseed());

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createInvite(classId = 'c1'): Promise<{ token: string; expiresAt: string; sharePath: string }> {
  const teacher = await wxLogin(app, 'dev-teacher');
  const res = await request(app).post(`/api/wx/teacher/classes/${classId}/invites`).set(auth(teacher));
  if (res.status !== 201) throw new Error(`createInvite failed: ${res.status}`);
  return res.body;
}

describe('POST /api/wx/teacher/classes/:id/invites 生成邀请', () => {
  it('老师生成邀请：token + 7 天过期 + sharePath', async () => {
    const body = await createInvite();
    expect(body.token).toHaveLength(16);
    expect(body.sharePath).toBe(`pages/join/index?invite=${body.token}`);
    const row = sqlite.prepare(`SELECT * FROM class_invites WHERE token=?`).get(body.token) as any;
    expect(row).toMatchObject({ class_id: 'c1', created_by: 't-wangli' });
    expect(row.expires_at > row.created_at).toBe(true);
  });

  it('可反复生成，新旧并存', async () => {
    const a = await createInvite();
    const b = await createInvite();
    expect(a.token).not.toBe(b.token);
    expect((await request(app).get(`/api/wx/invites/${a.token}`)).status).toBeLessThan(500);
  });

  it('未绑老师的账户 403；他组织班级 404', async () => {
    const parent = await wxLogin(app, 'dev-parent');
    expect((await request(app).post('/api/wx/teacher/classes/c1/invites').set(auth(parent))).status).toBe(403);
    const teacher = await wxLogin(app, 'dev-teacher');
    expect((await request(app).post('/api/wx/teacher/classes/c-out/invites').set(auth(teacher))).status).toBe(404);
  });
});

describe('GET /api/wx/invites/:token 预览', () => {
  it('有效邀请返回班级预览（需 wx 会话）', async () => {
    const { token } = await createInvite();
    const visitor = await wxLogin(app, 'brand-new');
    const res = await request(app).get(`/api/wx/invites/${token}`).set(auth(visitor));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      className: '三年级A班',
      teacherName: '王莉',
      orgName: '晨光英语',
      studentCount: 4,
    });
  });

  it('过期 404、不存在 404、未登录 401', async () => {
    const { token } = await createInvite();
    sqlite.prepare(`UPDATE class_invites SET expires_at=datetime('now','-1 hour') WHERE token=?`).run(token);
    const visitor = await wxLogin(app, 'brand-new');
    expect((await request(app).get(`/api/wx/invites/${token}`).set(auth(visitor))).status).toBe(404);
    expect((await request(app).get(`/api/wx/invites/nope`).set(auth(visitor))).status).toBe(404);
    expect((await request(app).get(`/api/wx/invites/${token}`)).status).toBe(401);
  });
});

describe('POST /api/wx/upload/photo 照片上传', () => {
  it('multipart 图片 → {key,url}；非图片 400；未登录 401', async () => {
    const visitor = await wxLogin(app, 'brand-new');
    const ok = await request(app)
      .post('/api/wx/upload/photo')
      .set(auth(visitor))
      .attach('photo', PNG, { filename: 'kid.png', contentType: 'image/png' });
    expect(ok.status).toBe(201);
    expect(ok.body.key).toMatch(/^students\/.+\.png$/);
    expect(ok.body.url).toContain(ok.body.key);

    const bad = await request(app)
      .post('/api/wx/upload/photo')
      .set(auth(visitor))
      .attach('photo', Buffer.from('hi'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(bad.status).toBe(400);
    expect((await request(app).post('/api/wx/upload/photo')).status).toBe(401);
  });
});

describe('POST /api/wx/invites/:token/join 提交注册', () => {
  it('建 pending join_request（四项落库，不建 student）', async () => {
    const { token } = await createInvite();
    const visitor = await wxLogin(app, 'brand-new');
    const res = await request(app)
      .post(`/api/wx/invites/${token}/join`)
      .set(auth(visitor))
      .send({ cnName: '朵朵', enName: 'Dora', parentPhone: '13800138000', photoKey: 'students/x.png' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ className: '三年级A班', status: 'pending' });
    const row = sqlite.prepare(`SELECT * FROM join_requests WHERE id=?`).get(res.body.id) as any;
    expect(row).toMatchObject({
      class_id: 'c1',
      cn_name: '朵朵',
      en_name: 'Dora',
      parent_phone: '13800138000',
      photo_key: 'students/x.png',
      status: 'pending',
    });
    // 不建 student
    expect((sqlite.prepare(`SELECT COUNT(*) c FROM students WHERE class_id='c1'`).get() as any).c).toBe(4);
    // me.pending 出现等待条目
    const me = await request(app).get('/api/wx/me').set(auth(visitor));
    expect(me.body.pending).toHaveLength(1);
    expect(me.body.pending[0]).toMatchObject({ classId: 'c1', className: '三年级A班', cnName: '朵朵' });
  });

  it('同班重复提交 → 覆盖更新同一条 pending', async () => {
    const { token } = await createInvite();
    const visitor = await wxLogin(app, 'brand-new');
    const first = await request(app).post(`/api/wx/invites/${token}/join`).set(auth(visitor)).send({ cnName: '朵朵' });
    const second = await request(app)
      .post(`/api/wx/invites/${token}/join`)
      .set(auth(visitor))
      .send({ cnName: '朵朵改', enName: 'Dora' });
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    const rows = sqlite.prepare(`SELECT * FROM join_requests WHERE class_id='c1' AND status='pending'`).all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cn_name: '朵朵改', en_name: 'Dora' });
  });

  it('中文名必填 400；手机号非 11 位 400', async () => {
    const { token } = await createInvite();
    const visitor = await wxLogin(app, 'brand-new');
    expect((await request(app).post(`/api/wx/invites/${token}/join`).set(auth(visitor)).send({})).status).toBe(400);
    const bad = await request(app)
      .post(`/api/wx/invites/${token}/join`)
      .set(auth(visitor))
      .send({ cnName: '朵朵', parentPhone: '12345' });
    expect(bad.status).toBe(400);
  });

  it('过期邀请 404；未登录 401', async () => {
    const { token } = await createInvite();
    sqlite.prepare(`UPDATE class_invites SET expires_at=datetime('now','-1 hour') WHERE token=?`).run(token);
    const visitor = await wxLogin(app, 'brand-new');
    expect(
      (await request(app).post(`/api/wx/invites/${token}/join`).set(auth(visitor)).send({ cnName: '朵朵' })).status,
    ).toBe(404);
    expect((await request(app).post(`/api/wx/invites/${token}/join`).send({ cnName: '朵朵' })).status).toBe(401);
  });
});
