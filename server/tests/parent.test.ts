import type DatabaseType from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp } from './helpers.js';

// 学生端（家长）免登录 API：邀请加入 + 个性化 recap。凭据即 token 本身
// （invite_token / recap_token），全部挂 /api/parent/*，不走老师会话。

let app: Express;
let sqlite: DatabaseType.Database;
let reseed: () => void;

beforeAll(async () => {
  ({ app, sqlite, reseed } = await setupTestApp());
});
beforeEach(() => reseed());

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // PNG magic + IHDR start

describe('GET /api/parent/join/:inviteToken 班级预览', () => {
  it('免登录返回班级信息', async () => {
    const res = await request(app).get('/api/parent/join/inv-c1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      className: '三年级A班',
      level: '新概念二册',
      teacherName: '王莉',
      orgName: '晨光英语',
      studentCount: 4,
    });
  });

  it('未知邀请码 404', async () => {
    const res = await request(app).get('/api/parent/join/nope');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/parent/join/:inviteToken 加入班级', () => {
  it('建 parent 来源学生并发 recapToken', async () => {
    const res = await request(app).post('/api/parent/join/inv-c1').send({ name: '朵朵' });
    expect(res.status).toBe(201);
    expect(res.body.recapToken).toBeTruthy();
    expect(res.body).toMatchObject({ name: '朵朵', className: '三年级A班' });
    const row = sqlite.prepare(`SELECT * FROM students WHERE id=?`).get(res.body.studentId) as any;
    expect(row).toMatchObject({ class_id: 'c1', name: '朵朵', source: 'parent', photo_url: null });
    expect(row.recap_token).toBe(res.body.recapToken);
  });

  it('携带 photoKey 时落到 photo_url', async () => {
    const res = await request(app).post('/api/parent/join/inv-c1').send({ name: '朵朵', photoKey: 'students/x.png' });
    expect(res.status).toBe(201);
    const row = sqlite.prepare(`SELECT photo_url FROM students WHERE id=?`).get(res.body.studentId) as any;
    expect(row.photo_url).toBe('students/x.png');
  });

  it('名字必填 400；未知邀请码 404', async () => {
    expect((await request(app).post('/api/parent/join/inv-c1').send({})).status).toBe(400);
    expect((await request(app).post('/api/parent/join/nope').send({ name: '朵朵' })).status).toBe(404);
  });
});

describe('POST /api/parent/join/:inviteToken/photo 照片上传', () => {
  it('multipart 图片存入 storage 并返回 key + url', async () => {
    const res = await request(app)
      .post('/api/parent/join/inv-c1/photo')
      .attach('photo', PNG, { filename: 'kid.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^students\/.+\.png$/);
    expect(res.body.url).toContain(res.body.key);
  });

  it('非图片 400；未知邀请码 404；缺文件 400', async () => {
    const bad = await request(app)
      .post('/api/parent/join/inv-c1/photo')
      .attach('photo', Buffer.from('hi'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(bad.status).toBe(400);
    const nope = await request(app)
      .post('/api/parent/join/nope/photo')
      .attach('photo', PNG, { filename: 'kid.png', contentType: 'image/png' });
    expect(nope.status).toBe(404);
    expect((await request(app).post('/api/parent/join/inv-c1/photo')).status).toBe(400);
  });
});

describe('GET /api/parent/me/:recapToken 学生主页', () => {
  it('返回学生 + 班级 + 已结束 sessions（新→旧）+ latestSessionId', async () => {
    const res = await request(app).get('/api/parent/me/tok-s1');
    expect(res.status).toBe(200);
    expect(res.body.student).toMatchObject({ id: 's1', name: '小明', photoUrl: null });
    expect(res.body.class).toMatchObject({
      name: '三年级A班',
      level: '新概念二册',
      teacherName: '王莉',
      orgName: '晨光英语',
    });
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0]).toMatchObject({ id: 'sess1', lessonNumber: 7, lessonTitle: 'Too late' });
    expect(res.body.latestSessionId).toBe('sess1');
  });

  it('未知 token 404', async () => {
    expect((await request(app).get('/api/parent/me/nope')).status).toBe(404);
  });
});

describe('GET /api/parent/me/:recapToken/sessions/:sessionId 个性化 recap', () => {
  it('出席学生：mine 四项 + 本人组高亮', async () => {
    const res = await request(app).get('/api/parent/me/tok-s1/sessions/sess1');
    expect(res.status).toBe(200);
    // 基础 recap 字段仍在
    expect(res.body).toMatchObject({ lessonNumber: 7, lessonTitle: 'Too late' });
    expect(res.body.stars.map((s: any) => s.name)).toContain('小明');
    // 本人卡：个人分只算 student 事件；检查记录按 PRD §8 口径
    expect(res.body.mine).toMatchObject({
      attended: true,
      groupName: '第1组',
      groupEmoji: '🦁',
      personalScore: 2,
      homework: '完成',
      recitation: '已背完',
    });
    // groups 按分排序且带 mine 标记：第1组(4) 在前且是本人组
    expect(res.body.groups[0]).toMatchObject({ name: '第1组', score: 4, mine: true });
    expect(res.body.groups[1]).toMatchObject({ name: '第2组', score: 0, mine: false });
  });

  it('缺记录口径：作业缺记录=没交，背书缺记录=未检查', async () => {
    const res = await request(app).get('/api/parent/me/tok-s3/sessions/sess1');
    expect(res.body.mine).toMatchObject({ personalScore: 0, homework: '没交', recitation: '未检查' });
  });

  it('缺席学生 attended=false', async () => {
    const res = await request(app).get('/api/parent/me/tok-s4/sessions/sess1');
    expect(res.body.mine).toMatchObject({ attended: false });
  });

  it('入班晚于该堂课（无 membership）→ mine=null', async () => {
    const joined = await request(app).post('/api/parent/join/inv-c1').send({ name: '新宝' });
    const res = await request(app).get(`/api/parent/me/${joined.body.recapToken}/sessions/sess1`);
    expect(res.status).toBe(200);
    expect(res.body.mine).toBeNull();
  });

  it('别班学生的 token 查本班 session → 404', async () => {
    expect((await request(app).get('/api/parent/me/tok-so1/sessions/sess1')).status).toBe(404);
  });

  it('未知 session 404', async () => {
    expect((await request(app).get('/api/parent/me/tok-s1/sessions/nope')).status).toBe(404);
  });
});

describe('auth gate 回归', () => {
  it('/api/parent/* 放行不影响其余接口仍 401', async () => {
    expect((await request(app).get('/api/me')).status).toBe(401);
    expect((await request(app).get('/api/classes')).status).toBe(401);
  });
});
