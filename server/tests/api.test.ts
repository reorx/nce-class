import type DatabaseType from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp } from './helpers.js';

let app: Express;
let sqlite: DatabaseType.Database;
let reseed: () => void;

beforeAll(async () => {
  ({ app, sqlite, reseed } = await setupTestApp());
});
beforeEach(() => reseed());

/** A supertest agent already logged in as 王莉 (org-1 owner). */
async function login(username = 'wangli', password = 'demo1234') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password });
  return { agent, res };
}

describe('auth', () => {
  it('logs in with the seeded password and returns the teacher', async () => {
    const { res } = await login();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: '王莉', username: 'wangli', role: 'owner', orgName: '晨光英语' });
    expect(res.headers['set-cookie'][0]).toMatch(/nce_session=.+HttpOnly/i);
  });

  it('rejects a wrong password with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'wangli', password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('blocks unauthenticated access to gated routes with 401', async () => {
    expect((await request(app).get('/api/classes')).status).toBe(401);
    expect((await request(app).get('/api/me')).status).toBe(401);
  });

  it('serves the current teacher once authenticated, and 401 after logout', async () => {
    const { agent } = await login();
    expect((await agent.get('/api/me')).status).toBe(200);
    await agent.post('/api/auth/logout');
    expect((await agent.get('/api/me')).status).toBe(401);
  });
});

describe('students', () => {
  it('adds a teacher-created student and reflects it in the class detail', async () => {
    const { agent } = await login();
    const created = await agent.post('/api/classes/c1/students').send({ name: '新同学' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: '新同学', source: 'teacher', score: 0 });

    const detail = (await agent.get('/api/classes/c1')).body;
    expect(detail.studentCount).toBe(5);
    expect(detail.students.map((s: any) => s.name)).toContain('新同学');
  });

  it('rejects a blank name with 400', async () => {
    const { agent } = await login();
    expect((await agent.post('/api/classes/c1/students').send({ name: '  ' })).status).toBe(400);
  });

  it('hard-deletes a student and wipes their ledger rows + memberships', async () => {
    const { agent } = await login();
    const res = await agent.delete('/api/students/s1');
    expect(res.status).toBe(200);

    const detail = (await agent.get('/api/classes/c1')).body;
    expect(detail.studentCount).toBe(3);
    expect(detail.students.map((s: any) => s.id)).not.toContain('s1');
    // group g1 no longer lists s1
    expect(detail.groups.find((g: any) => g.id === 'g1').memberIds).toEqual(['s2']);
    // ledger + membership rows gone
    const events = sqlite.prepare(`SELECT COUNT(*) c FROM score_events WHERE target_id='s1'`).get() as any;
    const mem = sqlite.prepare(`SELECT COUNT(*) c FROM class_group_memberships WHERE student_id='s1'`).get() as any;
    const smem = sqlite.prepare(`SELECT COUNT(*) c FROM session_memberships WHERE student_id='s1'`).get() as any;
    expect(events.c).toBe(0);
    expect(mem.c).toBe(0);
    expect(smem.c).toBe(0);
  });
});

describe('default grouping (PUT replace)', () => {
  it('rebuilds groups + memberships and assigns real ids to new groups', async () => {
    const { agent } = await login();
    const res = await agent.put('/api/classes/c1/groups').send({
      groups: [
        { id: 'g1', name: '第1组', emoji: '🦁', orderIndex: 0, memberIds: ['s1', 's2', 's3'] },
        { id: 'new-x', name: '新小组', emoji: '🐼', orderIndex: 1, memberIds: ['s4'] },
      ],
    });
    expect(res.status).toBe(200);

    const detail = res.body;
    const g1 = detail.groups.find((g: any) => g.id === 'g1');
    expect(g1.memberIds.sort()).toEqual(['s1', 's2', 's3']);
    // g2 was dropped (not in payload); a brand-new group got a real id
    expect(detail.groups.map((g: any) => g.id)).not.toContain('g2');
    const fresh = detail.groups.find((g: any) => g.name === '新小组');
    expect(fresh.id).not.toBe('new-x');
    expect(fresh.memberIds).toEqual(['s4']);
    // nobody ungrouped now
    expect(detail.students.every((s: any) => s.groupId != null)).toBe(true);
  });

  it('leaves students out of any group as ungrouped', async () => {
    const { agent } = await login();
    await agent.put('/api/classes/c1/groups').send({
      groups: [{ id: 'g1', name: '第1组', emoji: '🦁', orderIndex: 0, memberIds: ['s1'] }],
    });
    const detail = (await agent.get('/api/classes/c1')).body;
    const ungrouped = detail.students.filter((s: any) => s.groupId == null).map((s: any) => s.id);
    expect(ungrouped.sort()).toEqual(['s2', 's3', 's4']);
  });

  it('rejects a member that is not in the class with 400', async () => {
    const { agent } = await login();
    const res = await agent
      .put('/api/classes/c1/groups')
      .send({ groups: [{ name: 'X', emoji: null, orderIndex: 0, memberIds: ['so1'] }] });
    expect(res.status).toBe(400);
  });
});

describe('class creation', () => {
  it('creates a class owned by the acting teacher and lists it', async () => {
    const { agent } = await login();
    const created = await agent.post('/api/classes').send({ name: '四年级C班', level: '新概念三册' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: '四年级C班', teacherName: '王莉', studentCount: 0 });

    const list = (await agent.get('/api/classes')).body;
    expect(list.find((c: any) => c.name === '四年级C班')).toBeTruthy();
  });
});

describe('session recap', () => {
  it('derives group ranking, 亮眼/被提醒, and attendance from the ledger', async () => {
    const { agent } = await login();
    const recap = (await agent.get('/api/sessions/sess1/recap')).body;
    expect(recap.groups.map((g: any) => [g.name, g.score])).toEqual([
      ['第1组', 4],
      ['第2组', 0],
    ]);
    expect(recap.stars.map((s: any) => s.name)).toEqual(['小明']);
    expect(recap.warned.map((s: any) => s.name)).toEqual(['小刚']);
    expect(recap.attendancePresent).toBe(3);
    expect(recap.attendanceTotal).toBe(4);
  });
});

describe('cross-org isolation', () => {
  it("hides another org's class and blocks writes to it", async () => {
    const { agent } = await login(); // 王莉 in org-1
    expect((await agent.get('/api/classes/c-out')).status).toBe(404);
    expect((await agent.post('/api/classes/c-out/students').send({ name: 'x' })).status).toBe(404);
    expect((await agent.delete('/api/students/so1')).status).toBe(404);
    expect((await agent.put('/api/classes/c-out/groups').send({ groups: [] })).status).toBe(404);
  });
});
