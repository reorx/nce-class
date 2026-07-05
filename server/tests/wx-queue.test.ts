import type DatabaseType from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, wxLogin } from './helpers.js';

// 邀请队列与关联：老师看 pending 队列 → 关联到已有 student（建 binding +
// 回填空字段）或忽略；家长侧 children/recap 全部由 binding 守卫。

let app: Express;
let sqlite: DatabaseType.Database;
let reseed: () => void;

beforeAll(async () => {
  ({ app, sqlite, reseed } = await setupTestApp());
});
beforeEach(() => reseed());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** dev-teacher 生成邀请 → `name` 账户提交注册。返回 {requestId, visitorToken, teacherToken}。 */
async function joinAs(name: string, body: Record<string, unknown> = { cnName: '朵朵' }) {
  const teacherToken = await wxLogin(app, 'dev-teacher');
  const inv = await request(app).post('/api/wx/teacher/classes/c1/invites').set(auth(teacherToken));
  const visitorToken = await wxLogin(app, name);
  const joined = await request(app).post(`/api/wx/invites/${inv.body.token}/join`).set(auth(visitorToken)).send(body);
  if (joined.status !== 201) throw new Error(`join failed: ${joined.status}`);
  return { requestId: joined.body.id as string, visitorToken, teacherToken };
}

describe('GET /api/wx/teacher/classes 班级列表', () => {
  it('本组织班级 + pending 角标', async () => {
    const { teacherToken } = await joinAs('brand-new');
    const res = await request(app).get('/api/wx/teacher/classes').set(auth(teacherToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1); // 只有本组织的 c1
    expect(res.body[0]).toMatchObject({ id: 'c1', name: '三年级A班', studentCount: 4, pendingCount: 1 });
  });

  it('未绑老师 403', async () => {
    const parent = await wxLogin(app, 'dev-parent');
    expect((await request(app).get('/api/wx/teacher/classes').set(auth(parent))).status).toBe(403);
  });
});

describe('GET /api/wx/teacher/sessions 上课记录', () => {
  it('本组织全部课堂倒序 brief（含班级名 + 作业标记）', async () => {
    const teacher = await wxLogin(app, 'dev-teacher');
    const res = await request(app).get('/api/wx/teacher/sessions').set(auth(teacher));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 'sess1',
      classId: 'c1',
      className: '三年级A班',
      date: '06-26',
      year: '2026',
      lessonNumber: 7,
      lessonTitle: 'Too late',
      hasHomework: false,
    });
    // 布置作业后标记翻转
    sqlite.prepare(`UPDATE class_sessions SET homework_content='读课文' WHERE id='sess1'`).run();
    const res2 = await request(app).get('/api/wx/teacher/sessions').set(auth(teacher));
    expect(res2.body[0].hasHomework).toBe(true);
  });

  it('只看本组织；未绑老师 403；未登录 401', async () => {
    const out = await wxLogin(app, 'dev-out');
    expect((await request(app).get('/api/wx/teacher/sessions').set(auth(out))).body).toEqual([]);
    const parent = await wxLogin(app, 'dev-parent');
    expect((await request(app).get('/api/wx/teacher/sessions').set(auth(parent))).status).toBe(403);
    expect((await request(app).get('/api/wx/teacher/sessions')).status).toBe(401);
  });
});

describe('GET /api/wx/teacher/classes/:id/join-requests 队列', () => {
  it('pending 条目含注册四项 + 微信昵称', async () => {
    const { teacherToken } = await joinAs('brand-new', {
      cnName: '朵朵',
      enName: 'Dora',
      parentPhone: '13800138000',
      photoKey: 'students/x.png',
    });
    const res = await request(app).get('/api/wx/teacher/classes/c1/join-requests').set(auth(teacherToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ cnName: '朵朵', enName: 'Dora', parentPhone: '13800138000' });
    expect(res.body[0].photoUrl).toContain('students/x.png');
  });

  it('他组织班级 404', async () => {
    const teacher = await wxLogin(app, 'dev-teacher');
    expect((await request(app).get('/api/wx/teacher/classes/c-out/join-requests').set(auth(teacher))).status).toBe(404);
  });
});

describe('GET /api/wx/teacher/classes/:id/students 关联花名册', () => {
  it('返回学生并标注已关联者', async () => {
    const teacher = await wxLogin(app, 'dev-teacher');
    const res = await request(app).get('/api/wx/teacher/classes/c1/students').set(auth(teacher));
    expect(res.status).toBe(200);
    const byId = new Map(res.body.map((s: any) => [s.id, s]));
    expect((byId.get('s1') as any).linked).toBe(true); // wa-parent 已绑
    expect((byId.get('s2') as any).linked).toBe(false);
  });
});

describe('POST /api/wx/join-requests/:id/link 关联', () => {
  it('单事务：建 binding + status=linked + 回填空字段', async () => {
    const { requestId, visitorToken } = await joinAs('brand-new', {
      cnName: '浩浩',
      enName: 'Harry',
      parentPhone: '13800138000',
      photoKey: 'students/h.png',
    });
    const teacher = await wxLogin(app, 'dev-teacher');
    const res = await request(app)
      .post(`/api/wx/join-requests/${requestId}/link`)
      .set(auth(teacher))
      .send({ studentId: 's4' });
    expect(res.status).toBe(200);

    const req_ = sqlite.prepare(`SELECT * FROM join_requests WHERE id=?`).get(requestId) as any;
    expect(req_).toMatchObject({ status: 'linked', linked_student_id: 's4', handled_by: 't-wangli' });
    const s4 = sqlite.prepare(`SELECT * FROM students WHERE id='s4'`).get() as any;
    expect(s4).toMatchObject({ photo_url: 'students/h.png', en_name: 'Harry', parent_phone: '13800138000' });

    // 关联后：家长 me.children 出现、可拉个性化 recap，pending 清空
    const me = await request(app).get('/api/wx/me').set(auth(visitorToken));
    expect(me.body.pending).toEqual([]);
    expect(me.body.children).toHaveLength(1);
    expect(me.body.children[0]).toMatchObject({ studentId: 's4', name: '浩浩' });
    const recap = await request(app).get('/api/wx/students/s4/sessions/sess1').set(auth(visitorToken));
    expect(recap.status).toBe(200);
    expect(recap.body.mine).toMatchObject({ attended: false }); // s4 缺席
  });

  it('回填不覆盖已有值', async () => {
    sqlite.prepare(`UPDATE students SET photo_url='keep.png', en_name='Kept' WHERE id='s4'`).run();
    const { requestId } = await joinAs('brand-new', {
      cnName: '浩浩',
      enName: 'New',
      photoKey: 'students/h.png',
      parentPhone: '13800138000',
    });
    const teacher = await wxLogin(app, 'dev-teacher');
    await request(app).post(`/api/wx/join-requests/${requestId}/link`).set(auth(teacher)).send({ studentId: 's4' });
    const s4 = sqlite.prepare(`SELECT * FROM students WHERE id='s4'`).get() as any;
    expect(s4).toMatchObject({ photo_url: 'keep.png', en_name: 'Kept', parent_phone: '13800138000' });
  });

  it('跨组织老师 404；学生不在该班 400；重复关联同一请求 404', async () => {
    const { requestId } = await joinAs('brand-new');
    const out = await wxLogin(app, 'dev-out');
    expect(
      (await request(app).post(`/api/wx/join-requests/${requestId}/link`).set(auth(out)).send({ studentId: 's1' }))
        .status,
    ).toBe(404);
    const teacher = await wxLogin(app, 'dev-teacher');
    expect(
      (await request(app).post(`/api/wx/join-requests/${requestId}/link`).set(auth(teacher)).send({ studentId: 'so1' }))
        .status,
    ).toBe(400);
    await request(app).post(`/api/wx/join-requests/${requestId}/link`).set(auth(teacher)).send({ studentId: 's4' });
    expect(
      (await request(app).post(`/api/wx/join-requests/${requestId}/link`).set(auth(teacher)).send({ studentId: 's4' }))
        .status,
    ).toBe(404); // 已不是 pending
  });
});

describe('POST /api/wx/join-requests/:id/dismiss 忽略', () => {
  it('dismiss 后不再出现在 pending，可重新提交', async () => {
    const { requestId, visitorToken, teacherToken } = await joinAs('brand-new');
    const res = await request(app).post(`/api/wx/join-requests/${requestId}/dismiss`).set(auth(teacherToken));
    expect(res.status).toBe(200);
    const queue = await request(app).get('/api/wx/teacher/classes/c1/join-requests').set(auth(teacherToken));
    expect(queue.body).toEqual([]);
    const me = await request(app).get('/api/wx/me').set(auth(visitorToken));
    expect(me.body.pending).toEqual([]);
    // 同账户可再次提交（partial unique 只约束 pending）
    const inv = await request(app).post('/api/wx/teacher/classes/c1/invites').set(auth(teacherToken));
    const again = await request(app)
      .post(`/api/wx/invites/${inv.body.token}/join`)
      .set(auth(visitorToken))
      .send({ cnName: '朵朵2' });
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(requestId);
  });
});

describe('GET /api/wx/students/:id(/sessions/:sid) binding 守卫', () => {
  it('学生主页：班级 + ended sessions + latestSessionId', async () => {
    const parent = await wxLogin(app, 'dev-parent');
    const res = await request(app).get('/api/wx/students/s1').set(auth(parent));
    expect(res.status).toBe(200);
    expect(res.body.student).toMatchObject({ id: 's1', name: '小明' });
    expect(res.body.class).toMatchObject({ name: '三年级A班', teacherName: '王莉', orgName: '晨光英语' });
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.latestSessionId).toBe('sess1');
  });

  it('个性化 recap：本人卡 + 本人组高亮（口径与旧 /api/parent 一致）', async () => {
    const parent = await wxLogin(app, 'dev-parent');
    const res = await request(app).get('/api/wx/students/s1/sessions/sess1').set(auth(parent));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lessonNumber: 7, lessonTitle: 'Too late' });
    expect(res.body.mine).toMatchObject({
      attended: true,
      groupName: '第1组',
      groupEmoji: '🦁',
      personalScore: 2,
      homework: '完成',
      recitation: '已背完',
    });
    expect(res.body.groups[0]).toMatchObject({ name: '第1组', score: 4, mine: true });
    expect(res.body.groups[1]).toMatchObject({ name: '第2组', score: 0, mine: false });
  });

  it('缺记录口径：作业缺记录=没交、背书缺记录=未检查', async () => {
    sqlite
      .prepare(
        `INSERT INTO student_wechat_bindings (id, student_id, wechat_account_id, created_by) VALUES ('b3','s3','wa-parent','t-wangli')`,
      )
      .run();
    const parent = await wxLogin(app, 'dev-parent');
    const res = await request(app).get('/api/wx/students/s3/sessions/sess1').set(auth(parent));
    expect(res.body.mine).toMatchObject({ personalScore: 0, homework: '没交', recitation: '未检查' });
  });

  it('未绑定的学生 404；跨班 session 404；未登录 401', async () => {
    const parent = await wxLogin(app, 'dev-parent');
    expect((await request(app).get('/api/wx/students/s2').set(auth(parent))).status).toBe(404);
    expect((await request(app).get('/api/wx/students/s2/sessions/sess1').set(auth(parent))).status).toBe(404);
    expect((await request(app).get('/api/wx/students/s1/sessions/nope').set(auth(parent))).status).toBe(404);
    expect((await request(app).get('/api/wx/students/s1')).status).toBe(401);
  });

  it('多家长：两个账户绑同一学生各自可见', async () => {
    sqlite.prepare(`INSERT INTO wechat_accounts (id, openid) VALUES ('wa-mom','mock-openid-dev-mom')`).run();
    sqlite
      .prepare(
        `INSERT INTO student_wechat_bindings (id, student_id, wechat_account_id, created_by) VALUES ('b2','s1','wa-mom','t-wangli')`,
      )
      .run();
    const mom = await wxLogin(app, 'dev-mom');
    const res = await request(app).get('/api/wx/students/s1').set(auth(mom));
    expect(res.status).toBe(200);
    const dad = await wxLogin(app, 'dev-parent');
    expect((await request(app).get('/api/wx/students/s1').set(auth(dad))).status).toBe(200);
  });
});

describe('GET /api/classes/:id/join-requests web 只读队列（cookie 会话）', () => {
  it('老师 web 端看 pending 队列', async () => {
    await joinAs('brand-new', { cnName: '朵朵', enName: 'Dora' });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'wangli', password: 'demo1234' });
    const res = await agent.get('/api/classes/c1/join-requests');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ cnName: '朵朵', enName: 'Dora' });
  });

  it('未登录 401；他组织 404', async () => {
    expect((await request(app).get('/api/classes/c1/join-requests')).status).toBe(401);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'wangli', password: 'demo1234' });
    expect((await agent.get('/api/classes/c-out/join-requests')).status).toBe(404);
  });
});

describe('回归', () => {
  it('/api/parent/* 已删除（落入 cookie gate → 401/404，不再可用）', async () => {
    expect([401, 404]).toContain((await request(app).get('/api/parent/join/whatever')).status);
    expect([401, 404]).toContain((await request(app).get('/api/parent/me/whatever')).status);
  });

  it('老师 web cookie 会话不受影响', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'wangli', password: 'demo1234' });
    expect((await agent.get('/api/classes')).status).toBe(200);
    expect((await agent.get('/api/classes/c1')).status).toBe(200);
  });
});
