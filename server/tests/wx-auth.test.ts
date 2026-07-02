import type DatabaseType from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, wxLogin } from './helpers.js';

// 小程序会话：wx.login code → /api/wx/login 换 Bearer token（WX_MOCK stub），
// /api/wx/* 走 token 中间件；bind-teacher 一次性把微信账户绑到老师。

let app: Express;
let sqlite: DatabaseType.Database;
let reseed: () => void;

beforeAll(async () => {
  ({ app, sqlite, reseed } = await setupTestApp());
});
beforeEach(() => reseed());

describe('POST /api/wx/login', () => {
  it('mock code 首登建账户并发 token', async () => {
    const res = await request(app).post('/api/wx/login').send({ code: 'mock:brand-new' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.me.teacher).toBeNull();
    expect(res.body.me.children).toEqual([]);
    const row = sqlite.prepare(`SELECT * FROM wechat_accounts WHERE openid='mock-openid-brand-new'`).get() as any;
    expect(row).toBeTruthy();
    expect(row.last_login_at).toBeTruthy();
  });

  it('复登幂等：同 openid 不再建新账户', async () => {
    await request(app).post('/api/wx/login').send({ code: 'mock:brand-new' });
    await request(app).post('/api/wx/login').send({ code: 'mock:brand-new' });
    const n = sqlite
      .prepare(`SELECT COUNT(*) c FROM wechat_accounts WHERE openid='mock-openid-brand-new'`)
      .get() as any;
    expect(n.c).toBe(1);
  });

  it('坏 code 401', async () => {
    expect((await request(app).post('/api/wx/login').send({ code: 'nope' })).status).toBe(401);
    expect((await request(app).post('/api/wx/login').send({})).status).toBe(401);
  });

  it('已绑老师的账户登录 → me.teacher 非空', async () => {
    const res = await request(app).post('/api/wx/login').send({ code: 'mock:dev-teacher' });
    expect(res.body.me.teacher).toMatchObject({ id: 't-wangli', name: '王莉', orgName: '晨光英语' });
  });

  it('已绑学生的账户登录 → me.children 含孩子', async () => {
    const res = await request(app).post('/api/wx/login').send({ code: 'mock:dev-parent' });
    expect(res.body.me.children).toHaveLength(1);
    expect(res.body.me.children[0]).toMatchObject({
      studentId: 's1',
      name: '小明',
      classId: 'c1',
      className: '三年级A班',
    });
  });
});

describe('/api/wx/* token 中间件', () => {
  it('无 token / 坏 token → 401', async () => {
    expect((await request(app).get('/api/wx/me')).status).toBe(401);
    expect((await request(app).get('/api/wx/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });

  it('老师 cookie 会话不能当 wx token；wx token 也进不了 cookie 接口', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'wangli', password: 'demo1234' });
    expect((await agent.get('/api/wx/me')).status).toBe(401);
    const token = await wxLogin(app, 'dev-teacher');
    expect((await request(app).get('/api/classes').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('有效 token → GET /api/wx/me', async () => {
    const token = await wxLogin(app, 'dev-parent');
    const res = await request(app).get('/api/wx/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.account.nickname).toBe('小明爸爸(dev)');
    expect(res.body.children[0].studentId).toBe('s1');
    expect(res.body.pending).toEqual([]);
  });
});

describe('POST /api/wx/bind-teacher', () => {
  it('正确用户名密码 → 建 wechat credential，me.teacher 生效', async () => {
    // t-out 在 helpers 里已被 wa-out 绑定，先解绑腾出老师（模拟未绑老师）
    sqlite.prepare(`DELETE FROM credentials WHERE id='cred-wx-out'`).run();
    const token = await wxLogin(app, 'brand-new');
    const res = await request(app)
      .post('/api/wx/bind-teacher')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'waiguo', password: 'demo1234' });
    expect(res.status).toBe(200);
    expect(res.body.teacher).toMatchObject({ id: 't-out', name: '外老师' });
    const cred = sqlite
      .prepare(`SELECT * FROM credentials WHERE teacher_id='t-out' AND provider='wechat'`)
      .get() as any;
    expect(cred.wechat_account_id).toBeTruthy();
    const me = await request(app).get('/api/wx/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.teacher.id).toBe('t-out');
  });

  it('错密码 401', async () => {
    const token = await wxLogin(app, 'brand-new');
    const res = await request(app)
      .post('/api/wx/bind-teacher')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'wangli', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('老师已被别的微信绑定 → 409', async () => {
    const token = await wxLogin(app, 'brand-new');
    const res = await request(app)
      .post('/api/wx/bind-teacher')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'wangli', password: 'demo1234' });
    expect(res.status).toBe(409);
  });

  it('该微信已绑过老师 → 409', async () => {
    sqlite.prepare(`DELETE FROM credentials WHERE id='cred-wx-out'`).run();
    const token = await wxLogin(app, 'dev-teacher'); // 已绑 wangli
    const res = await request(app)
      .post('/api/wx/bind-teacher')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'waiguo', password: 'demo1234' });
    expect(res.status).toBe(409);
  });
});
