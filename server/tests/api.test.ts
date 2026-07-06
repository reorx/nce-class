import type DatabaseType from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, wxLogin } from './helpers.js';

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

  it('verifies the current teacher password (放弃本节课 gate)', async () => {
    const { agent } = await login();
    const ok = await agent.post('/api/auth/verify-password').send({ password: 'demo1234' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
  });

  it('rejects a wrong current-teacher password with 403 (not 401, session stays valid)', async () => {
    const { agent } = await login();
    const bad = await agent.post('/api/auth/verify-password').send({ password: 'nope' });
    expect(bad.status).toBe(403);
    expect((await agent.get('/api/me')).status).toBe(200);
  });

  it('verify-password checks the logged-in teacher, not any teacher', async () => {
    // waiguo (org-2) shares the seed password; log in as him and verify works,
    // but an empty/absent password is still rejected.
    const { agent } = await login('waiguo');
    expect((await agent.post('/api/auth/verify-password').send({ password: 'demo1234' })).status).toBe(200);
    expect((await agent.post('/api/auth/verify-password').send({})).status).toBe(403);
  });

  it('blocks unauthenticated verify-password with 401', async () => {
    expect((await request(app).post('/api/auth/verify-password').send({ password: 'demo1234' })).status).toBe(401);
  });
});

describe('teachers', () => {
  it('lists only same-org teachers', async () => {
    const { agent } = await login();
    const res = await agent.get('/api/teachers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 't-wangli', name: '王莉', username: 'wangli', role: 'owner' }]);
  });

  it('creates a teacher who can log in immediately', async () => {
    const { agent } = await login();
    const created = await agent.post('/api/teachers').send({ name: '李芳', username: 'lifang', password: 'secret66' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: '李芳', username: 'lifang', role: 'teacher' });

    // shows up in the list, pinned to the creator's org
    const list = (await agent.get('/api/teachers')).body;
    expect(list.map((t: any) => t.username)).toEqual(['wangli', 'lifang']);
    const row = sqlite.prepare(`SELECT org_id FROM teachers WHERE username='lifang'`).get() as any;
    expect(row.org_id).toBe('org-1');

    // the new account works right away
    const { res } = await login('lifang', 'secret66');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: '李芳', role: 'teacher' });
  });

  it('rejects a duplicate username with 409, even across orgs', async () => {
    const { agent } = await login();
    const sameOrg = await agent
      .post('/api/teachers')
      .send({ name: '假王莉', username: 'wangli', password: 'secret66' });
    expect(sameOrg.status).toBe(409);
    // 'waiguo' lives in org-2; usernames are globally unique
    const crossOrg = await agent
      .post('/api/teachers')
      .send({ name: '假外老师', username: 'waiguo', password: 'secret66' });
    expect(crossOrg.status).toBe(409);
  });

  it('rejects blank fields and short passwords with 400', async () => {
    const { agent } = await login();
    expect((await agent.post('/api/teachers').send({ name: ' ', username: 'x1', password: 'secret66' })).status).toBe(
      400,
    );
    expect((await agent.post('/api/teachers').send({ name: '李芳', username: ' ', password: 'secret66' })).status).toBe(
      400,
    );
    expect(
      (await agent.post('/api/teachers').send({ name: '李芳', username: 'lifang', password: '12345' })).status,
    ).toBe(400);
    // nothing was created
    const c = sqlite.prepare(`SELECT COUNT(*) c FROM teachers`).get() as any;
    expect(c.c).toBe(2);
  });

  it('blocks unauthenticated access with 401', async () => {
    expect((await request(app).get('/api/teachers')).status).toBe(401);
    expect(
      (await request(app).post('/api/teachers').send({ name: '李芳', username: 'lifang', password: 'secret66' }))
        .status,
    ).toBe(401);
  });

  it('renames a teacher without touching the username or password', async () => {
    const { agent } = await login();
    const res = await agent.put('/api/teachers/t-wangli').send({ name: '王老师' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 't-wangli', name: '王老师', username: 'wangli', role: 'owner' });
    // username stays put, the original password still logs in
    const row = sqlite.prepare(`SELECT name, username FROM teachers WHERE id='t-wangli'`).get() as any;
    expect(row).toEqual({ name: '王老师', username: 'wangli' });
    expect((await login('wangli', 'demo1234')).res.status).toBe(200);
  });

  it('changes the password only when a non-blank one is provided', async () => {
    const { agent } = await login();
    // blank password → unchanged
    expect((await agent.put('/api/teachers/t-wangli').send({ name: '王莉', password: '' })).status).toBe(200);
    expect((await login('wangli', 'demo1234')).res.status).toBe(200);
    // real password → old one stops working, new one logs in
    expect((await agent.put('/api/teachers/t-wangli').send({ name: '王莉', password: 'newpass9' })).status).toBe(200);
    expect((await login('wangli', 'demo1234')).res.status).toBe(401);
    expect((await login('wangli', 'newpass9')).res.status).toBe(200);
  });

  it('rejects a blank name or a too-short password with 400', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/teachers/t-wangli').send({ name: '   ' })).status).toBe(400);
    expect((await agent.put('/api/teachers/t-wangli').send({ name: '王莉', password: '12345' })).status).toBe(400);
    // nothing changed
    expect((await login('wangli', 'demo1234')).res.status).toBe(200);
    expect((sqlite.prepare(`SELECT name FROM teachers WHERE id='t-wangli'`).get() as any).name).toBe('王莉');
  });

  it('404 for a teacher outside the acting org', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/teachers/t-out').send({ name: '黑手' })).status).toBe(404);
    expect((await agent.put('/api/teachers/nope').send({ name: '幽灵' })).status).toBe(404);
    expect((sqlite.prepare(`SELECT name FROM teachers WHERE id='t-out'`).get() as any).name).toBe('外老师');
  });
});

describe('students', () => {
  it('adds a teacher-created student and reflects it in the class detail', async () => {
    const { agent } = await login();
    const created = await agent.post('/api/classes/c1/students').send({ name: '新同学' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: '新同学', source: 'teacher', score: 0, status: 'active' });

    const detail = (await agent.get('/api/classes/c1')).body;
    expect(detail.studentCount).toBe(5);
    expect(detail.students.map((s: any) => s.name)).toContain('新同学');
  });

  it('rejects a blank name with 400', async () => {
    const { agent } = await login();
    expect((await agent.post('/api/classes/c1/students').send({ name: '  ' })).status).toBe(400);
  });

  it('renames a student (PUT /api/students/:id) and reflects it in the class detail', async () => {
    const { agent } = await login();
    const res = await agent.put('/api/students/s1').send({ name: '小明明' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 's1', name: '小明明' });
    expect((sqlite.prepare(`SELECT name FROM students WHERE id='s1'`).get() as any).name).toBe('小明明');

    const detail = (await agent.get('/api/classes/c1')).body;
    expect(detail.students.find((s: any) => s.id === 's1').name).toBe('小明明');
  });

  it('rejects a blank rename, unknown ids and cross-org students', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/students/s1').send({ name: '  ' })).status).toBe(400);
    expect((await agent.put('/api/students/nope').send({ name: '张三' })).status).toBe(404);

    const out = (await login('waiguo')).agent;
    expect((await out.put('/api/students/s1').send({ name: '张三' })).status).toBe(404);
    expect((sqlite.prepare(`SELECT name FROM students WHERE id='s1'`).get() as any).name).toBe('小明');
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
    const stags = sqlite.prepare(`SELECT COUNT(*) c FROM session_tags WHERE student_id='s1'`).get() as any;
    expect(events.c).toBe(0);
    expect(mem.c).toBe(0);
    expect(smem.c).toBe(0);
    expect(stags.c).toBe(0);
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
    const created = await agent.post('/api/classes').send({ name: '四年级C班' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: '四年级C班', teacherName: '王莉', studentCount: 0 });

    const list = (await agent.get('/api/classes')).body;
    expect(list.find((c: any) => c.name === '四年级C班')).toBeTruthy();
  });

  it('accepts an explicit 负责老师, rejecting unknown or cross-org ones with 400', async () => {
    const { agent } = await login();
    const t2 = await agent.post('/api/teachers').send({ name: '李芳', username: 'lifang', password: 'secret66' });
    const created = await agent.post('/api/classes').send({ name: '五年级D班', teacherId: t2.body.id });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ teacherId: t2.body.id, teacherName: '李芳' });

    expect((await agent.post('/api/classes').send({ name: 'X', teacherId: 'nope' })).status).toBe(400);
    expect((await agent.post('/api/classes').send({ name: 'X', teacherId: 't-out' })).status).toBe(400);
  });
});

describe('class info update', () => {
  it('updates name and 负责老师, echoing the new detail', async () => {
    const { agent } = await login();
    const created = await agent.post('/api/teachers').send({ name: '李芳', username: 'lifang', password: 'secret66' });
    const res = await agent.put('/api/classes/c1').send({ name: '三年级B班', teacherId: created.body.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: '三年级B班',
      teacherId: created.body.id,
      teacherName: '李芳',
    });

    const row = sqlite.prepare(`SELECT name, teacher_id FROM classes WHERE id='c1'`).get() as any;
    expect(row).toEqual({ name: '三年级B班', teacher_id: created.body.id });
    // the class list reflects the change too
    const list = (await agent.get('/api/classes')).body;
    expect(list.find((c: any) => c.id === 'c1')).toMatchObject({ name: '三年级B班', teacherName: '李芳' });
  });

  it('exposes teacherId in the class detail for form prefill', async () => {
    const { agent } = await login();
    expect((await agent.get('/api/classes/c1')).body.teacherId).toBe('t-wangli');
  });

  it('rejects a missing name or 负责老师 with 400', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/classes/c1').send({ teacherId: 't-wangli' })).status).toBe(400);
    expect((await agent.put('/api/classes/c1').send({ name: '   ', teacherId: 't-wangli' })).status).toBe(400);
    expect((await agent.put('/api/classes/c1').send({ name: 'X' })).status).toBe(400);
  });

  it('rejects an unknown or cross-org 负责老师 with 400, leaving the class untouched', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/classes/c1').send({ name: 'X', teacherId: 'nope' })).status).toBe(400);
    expect((await agent.put('/api/classes/c1').send({ name: 'X', teacherId: 't-out' })).status).toBe(400);
    const row = sqlite.prepare(`SELECT name, teacher_id FROM classes WHERE id='c1'`).get() as any;
    expect(row).toEqual({ name: '三年级A班', teacher_id: 't-wangli' });
  });

  it('404s on unknown and cross-org classes', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/classes/nope').send({ name: 'X', teacherId: 't-wangli' })).status).toBe(404);

    const out = (await login('waiguo')).agent;
    expect((await out.put('/api/classes/c1').send({ name: '黑', teacherId: 't-out' })).status).toBe(404);
    expect((sqlite.prepare(`SELECT name FROM classes WHERE id='c1'`).get() as any).name).toBe('三年级A班');
  });
});

describe('class notes', () => {
  it('saves markdown notes and echoes them in the class detail', async () => {
    const { agent } = await login();
    const md = '# 教材\n\n- 新概念二册\n- [单词表](https://example.com/words)';
    const res = await agent.put('/api/classes/c1/notes').send({ notes: md });
    expect(res.status).toBe(200);
    expect(res.body.notes).toBe(md);

    expect((sqlite.prepare(`SELECT notes FROM classes WHERE id='c1'`).get() as any).notes).toBe(md);
    expect((await agent.get('/api/classes/c1')).body.notes).toBe(md);
  });

  it('defaults to null and clears back to null on blank input', async () => {
    const { agent } = await login();
    expect((await agent.get('/api/classes/c1')).body.notes).toBeNull();

    await agent.put('/api/classes/c1/notes').send({ notes: '内容' });
    const res = await agent.put('/api/classes/c1/notes').send({ notes: '   ' });
    expect(res.status).toBe(200);
    expect(res.body.notes).toBeNull();
    expect((sqlite.prepare(`SELECT notes FROM classes WHERE id='c1'`).get() as any).notes).toBeNull();
  });

  it('rejects non-string bodies, unknown and cross-org classes', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/classes/c1/notes').send({ notes: 42 })).status).toBe(400);
    expect((await agent.put('/api/classes/c1/notes').send({})).status).toBe(400);
    expect((await agent.put('/api/classes/nope/notes').send({ notes: 'x' })).status).toBe(404);

    const out = (await login('waiguo')).agent;
    expect((await out.put('/api/classes/c1/notes').send({ notes: 'x' })).status).toBe(404);
    expect((sqlite.prepare(`SELECT notes FROM classes WHERE id='c1'`).get() as any).notes).toBeNull();
  });
});

describe('class textbook (教材册数)', () => {
  it('persists 1-4 through create and update, echoing in the detail', async () => {
    const { agent } = await login();
    const created = await agent.post('/api/classes').send({ name: '四年级C班', textbook: 2 });
    expect(created.status).toBe(201);
    expect(created.body.textbook).toBe(2);

    const res = await agent.put('/api/classes/c1').send({ name: '三年级A班', teacherId: 't-wangli', textbook: 3 });
    expect(res.status).toBe(200);
    expect(res.body.textbook).toBe(3);
    expect((sqlite.prepare(`SELECT textbook FROM classes WHERE id='c1'`).get() as any).textbook).toBe(3);
  });

  it('defaults to null when omitted and clears back to null', async () => {
    const { agent } = await login();
    expect((await agent.get('/api/classes/c1')).body.textbook).toBeNull();
    expect((await agent.post('/api/classes').send({ name: '新班' })).body.textbook).toBeNull();

    await agent.put('/api/classes/c1').send({ name: '三年级A班', teacherId: 't-wangli', textbook: 2 });
    const res = await agent.put('/api/classes/c1').send({ name: '三年级A班', teacherId: 't-wangli', textbook: null });
    expect(res.status).toBe(200);
    expect(res.body.textbook).toBeNull();
  });

  it('rejects an out-of-range or non-integer 册数 with 400, leaving the class untouched', async () => {
    const { agent } = await login();
    for (const bad of [0, 5, 1.5, '2']) {
      expect(
        (await agent.put('/api/classes/c1').send({ name: 'X', teacherId: 't-wangli', textbook: bad })).status,
      ).toBe(400);
      expect((await agent.post('/api/classes').send({ name: 'Y', textbook: bad })).status).toBe(400);
    }
    const row = sqlite.prepare(`SELECT name, textbook FROM classes WHERE id='c1'`).get() as any;
    expect(row).toEqual({ name: '三年级A班', textbook: null });
  });
});

describe('class homework template', () => {
  it('saves the template and echoes it in the class detail', async () => {
    const { agent } = await login();
    const tpl = '- L{lesson_number} 三英一汉，听写三遍\n- 练字三面\n- 背L{lesson_number}';
    const res = await agent.put('/api/classes/c1/homework-template').send({ template: tpl });
    expect(res.status).toBe(200);
    expect(res.body.homeworkTemplate).toBe(tpl);

    expect((sqlite.prepare(`SELECT homework_template FROM classes WHERE id='c1'`).get() as any).homework_template).toBe(
      tpl,
    );
    expect((await agent.get('/api/classes/c1')).body.homeworkTemplate).toBe(tpl);
  });

  it('defaults to null and clears back to null on blank input', async () => {
    const { agent } = await login();
    expect((await agent.get('/api/classes/c1')).body.homeworkTemplate).toBeNull();

    await agent.put('/api/classes/c1/homework-template').send({ template: '- 背课文' });
    const res = await agent.put('/api/classes/c1/homework-template').send({ template: '   ' });
    expect(res.status).toBe(200);
    expect(res.body.homeworkTemplate).toBeNull();
    expect(
      (sqlite.prepare(`SELECT homework_template FROM classes WHERE id='c1'`).get() as any).homework_template,
    ).toBeNull();
  });

  it('rejects non-string bodies, unknown and cross-org classes', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/classes/c1/homework-template').send({ template: 42 })).status).toBe(400);
    expect((await agent.put('/api/classes/c1/homework-template').send({})).status).toBe(400);
    expect((await agent.put('/api/classes/nope/homework-template').send({ template: 'x' })).status).toBe(404);

    const out = (await login('waiguo')).agent;
    expect((await out.put('/api/classes/c1/homework-template').send({ template: 'x' })).status).toBe(404);
    expect(
      (sqlite.prepare(`SELECT homework_template FROM classes WHERE id='c1'`).get() as any).homework_template,
    ).toBeNull();
  });
});

describe('org-wide session list (GET /api/sessions)', () => {
  it('lists every session of the org with class context, newest first, org-isolated', async () => {
    const { agent } = await login();
    // a later second session on c1, plus one on the org-2 class that must not leak
    sqlite
      .prepare(
        `INSERT INTO class_sessions (id, class_id, teacher_id, date, lesson_number, lesson_title, status, planned_duration_min, started_at, ended_at)
         VALUES ('sess2','c1','t-wangli','2026-06-28',8,'The best and the worst','ended',120,'2026-06-28 09:00:00','2026-06-28 11:05:00')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO class_sessions (id, class_id, teacher_id, date, status, planned_duration_min)
         VALUES ('sess-out','c-out','t-out','2026-06-27','ended',120)`,
      )
      .run();
    const res = await agent.get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body.map((s: any) => s.id)).toEqual(['sess2', 'sess1']);
    // rows share the 上课记录 summary shape, plus the owning class for cross-class display
    expect(res.body[1]).toMatchObject({
      id: 'sess1',
      date: '06-26',
      year: '2026',
      weekday: '周五',
      lessonNumber: 7,
      lessonTitle: 'Too late',
      teacherName: '王莉',
      startedAt: '2026-06-26 19:00:00',
      endedAt: '2026-06-26 20:58:00',
      groupCount: 2,
      classId: 'c1',
      className: '三年级A班',
      attendancePresent: 3,
      attendanceTotal: 4,
    });
    // sess2 has no memberships at all (legacy-shaped row) → zero counts, not null
    expect(res.body[0]).toMatchObject({ attendancePresent: 0, attendanceTotal: 0 });
  });

  it('breaks same-day ties by start time, latest first', async () => {
    const { agent } = await login();
    sqlite
      .prepare(
        `INSERT INTO class_sessions (id, class_id, teacher_id, date, lesson_number, status, planned_duration_min, started_at, ended_at)
         VALUES ('sess-am','c1','t-wangli','2026-06-26',6,'ended',120,'2026-06-26 09:00:00','2026-06-26 11:00:00')`,
      )
      .run();
    const res = await agent.get('/api/sessions');
    expect(res.body.map((s: any) => s.id)).toEqual(['sess1', 'sess-am']);
  });

  it('blocks unauthenticated access with 401', async () => {
    expect((await request(app).get('/api/sessions')).status).toBe(401);
  });
});

describe('session detail (GET /api/sessions/:id)', () => {
  it('returns the session summary with class context, homework fields and embedded recap', async () => {
    const { agent } = await login();
    const res = await agent.get('/api/sessions/sess1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'sess1',
      date: '06-26',
      year: '2026',
      lessonNumber: 7,
      lessonTitle: 'Too late',
      teacherName: '王莉',
      groupCount: 2,
      classId: 'c1',
      className: '三年级A班',
      classTextbook: null,
      homeworkTemplate: null,
      homeworkContent: null,
      reviewBook: null,
      reviewLesson: null,
      hasHomework: false,
      attendancePresent: 3,
      attendanceTotal: 4,
    });
    // the embedded recap is byte-identical to the standalone recap endpoint
    const recap = (await agent.get('/api/sessions/sess1/recap')).body;
    expect(res.body.recap).toEqual(recap);
  });

  it('embeds the 课堂情况 overview: attendance, per-group member scores and check buckets', async () => {
    const { agent } = await login();
    const { overview } = (await agent.get('/api/sessions/sess1')).body;
    // s1 小明/s2 小红/s3 小刚 present, s4 浩浩 absent (ungrouped)
    expect(overview).toMatchObject({
      totalStudents: 4,
      present: ['小明', '小红', '小刚'],
      absent: ['浩浩'],
      classScore: 4, // sg1 nested +4 (小明+2, 小红+1, group+1); sg2 net 0
    });
    // groups ranked by score; absent/ungrouped s4 appears in no group card
    expect(overview.groups).toEqual([
      {
        id: 'sg1',
        name: '第1组',
        emoji: '🦁',
        score: 4,
        members: [
          { name: '小明', score: 2, absent: false },
          { name: '小红', score: 1, absent: false },
        ],
      },
      { id: 'sg2', name: '第2组', emoji: '🐯', score: 0, members: [{ name: '小刚', score: 0, absent: false }] },
    ]);
    // present-only check buckets: s1 done+已背完, s2 没交+背完部分, s3 没交+未检查
    expect(overview.homework).toEqual({ done: ['小明'], redo: [], miss: ['小红', '小刚'] });
    expect(overview.recitation).toEqual({ full: ['小明'], part: ['小红'], none: [], unchecked: ['小刚'] });
  });

  it('carries the class textbook and template for the 作业布置 tab defaults', async () => {
    const { agent } = await login();
    await agent.put('/api/classes/c1').send({ name: '三年级A班', teacherId: 't-wangli', textbook: 2 });
    await agent.put('/api/classes/c1/homework-template').send({ template: '- 背L{lesson_number}' });
    const res = await agent.get('/api/sessions/sess1');
    expect(res.body.classTextbook).toBe(2);
    expect(res.body.homeworkTemplate).toBe('- 背L{lesson_number}');
  });

  it('401 unauthenticated, 404 unknown and cross-org sessions', async () => {
    expect((await request(app).get('/api/sessions/sess1')).status).toBe(401);
    const { agent } = await login();
    expect((await agent.get('/api/sessions/nope')).status).toBe(404);
    const out = (await login('waiguo')).agent;
    expect((await out.get('/api/sessions/sess1')).status).toBe(404);
  });
});

describe('session homework (完成布置)', () => {
  it('saves content + 课文复习 selection and echoes the fresh session detail', async () => {
    const { agent } = await login();
    const content = '- L7 三英一汉，听写三遍\n- 练字三面';
    const res = await agent.put('/api/sessions/sess1/homework').send({ content, reviewBook: 2, reviewLesson: 7 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'sess1',
      homeworkContent: content,
      reviewBook: 2,
      reviewLesson: 7,
      hasHomework: true,
    });

    const row = sqlite
      .prepare(`SELECT homework_content, review_book, review_lesson FROM class_sessions WHERE id='sess1'`)
      .get() as any;
    expect(row).toEqual({ homework_content: content, review_book: 2, review_lesson: 7 });
    // 上课记录 badge source
    const d = (await agent.get('/api/classes/c1')).body;
    expect(d.sessions.find((s: any) => s.id === 'sess1').hasHomework).toBe(true);
  });

  it('clears blank content to null (课文复习 selection may stand alone)', async () => {
    const { agent } = await login();
    const res = await agent
      .put('/api/sessions/sess1/homework')
      .send({ content: '   ', reviewBook: 1, reviewLesson: 144 });
    expect(res.status).toBe(200);
    expect(res.body.homeworkContent).toBeNull();
    expect(res.body.hasHomework).toBe(false);
    expect(res.body.reviewBook).toBe(1);
    expect(res.body.reviewLesson).toBe(144);
  });

  it('rejects an out-of-range 册数/课数 or a lesson without a book with 400, leaving the row untouched', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/sessions/sess1/homework').send({ content: 42 })).status).toBe(400);
    expect((await agent.put('/api/sessions/sess1/homework').send({ content: 'x', reviewBook: 5 })).status).toBe(400);
    expect((await agent.put('/api/sessions/sess1/homework').send({ content: 'x', reviewLesson: 3 })).status).toBe(400);
    expect(
      (await agent.put('/api/sessions/sess1/homework').send({ content: 'x', reviewBook: 4, reviewLesson: 49 })).status,
    ).toBe(400);
    expect(
      (await agent.put('/api/sessions/sess1/homework').send({ content: 'x', reviewBook: 2, reviewLesson: 0 })).status,
    ).toBe(400);
    const row = sqlite
      .prepare(`SELECT homework_content, review_book, review_lesson FROM class_sessions WHERE id='sess1'`)
      .get() as any;
    expect(row).toEqual({ homework_content: null, review_book: null, review_lesson: null });
  });

  it('does not disturb the ledger-derived recap', async () => {
    const { agent } = await login();
    const before = (await agent.get('/api/sessions/sess1/recap')).body;
    await agent.put('/api/sessions/sess1/homework').send({ content: '作业', reviewBook: 2, reviewLesson: 7 });
    expect((await agent.get('/api/sessions/sess1/recap')).body).toEqual(before);
  });

  it('401 unauthenticated, 404 unknown and cross-org sessions', async () => {
    expect((await request(app).put('/api/sessions/sess1/homework').send({ content: 'x' })).status).toBe(401);
    const { agent } = await login();
    expect((await agent.put('/api/sessions/nope/homework').send({ content: 'x' })).status).toBe(404);
    const out = (await login('waiguo')).agent;
    expect((await out.put('/api/sessions/sess1/homework').send({ content: 'x' })).status).toBe(404);
    expect(
      (sqlite.prepare(`SELECT homework_content FROM class_sessions WHERE id='sess1'`).get() as any).homework_content,
    ).toBeNull();
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
    // stars carry a resolved photoUrl (storage key → URL; null when no photo)
    expect(recap.stars[0].photoUrl).toBeNull();
    sqlite.prepare(`UPDATE students SET photo_url='photos/xm.png' WHERE id='s1'`).run();
    const withPhoto = (await agent.get('/api/sessions/sess1/recap')).body;
    expect(withPhoto.stars[0].photoUrl).toBe('/uploads/photos/xm.png');
    expect(recap.attendancePresent).toBe(3);
    expect(recap.attendanceTotal).toBe(4);
    // 奖章 tags grouped per student (seeded: s1 got 进步之星)
    expect(recap.studentTags).toEqual([{ name: '小明', tags: ['进步之星'] }]);
  });
});

describe('org tag library (GET /api/tags)', () => {
  it('lists the org library and stays org-isolated', async () => {
    const { agent } = await login();
    const res = await agent.get('/api/tags');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'tag1', name: '进步之星' }]);

    const out = await login('waiguo'); // org-2 sees nothing of org-1's library
    expect((await out.agent.get('/api/tags')).body).toEqual([]);
  });

  it('requires a session (401 unauthenticated)', async () => {
    expect((await request(app).get('/api/tags')).status).toBe(401);
  });
});

describe('student growth profile', () => {
  /** A second ended session so the matrix has 2 columns: s1 present(−1), s2 absent, s3 present; s4 has NO membership row (未入班). */
  const addSession2 = () => {
    sqlite.exec(`
      INSERT INTO class_sessions (id, class_id, teacher_id, date, lesson_number, lesson_title, status, planned_duration_min, started_at, ended_at)
      VALUES ('sess2','c1','t-wangli','2026-07-03',8,'The best and the worst','ended',120,'2026-07-03 19:00:00','2026-07-03 21:00:00');
      INSERT INTO session_groups (id, session_id, name, emoji, order_index)
      VALUES ('sg3','sess2','第1组','🦁',0),('sg4','sess2','第2组','🐯',1);
      INSERT INTO session_memberships (id, session_id, student_id, session_group_id, attendance)
      VALUES ('sm2-s1','sess2','s1','sg3','present'),('sm2-s2','sess2','s2',NULL,'absent'),('sm2-s3','sess2','s3','sg4','present');
      INSERT INTO score_events (id, session_id, target_type, target_id, session_group_id, delta, created_by)
      VALUES ('e2-1','sess2','student','s1','sg3',-1,'t-wangli');
      INSERT INTO check_records (id, session_id, student_id, type, status)
      VALUES ('ck2-1','sess2','s1','recitation','背完部分');
    `);
  };

  it('blocks unauthenticated access with 401', async () => {
    expect((await request(app).get('/api/students/s1/profile')).status).toBe(401);
  });

  it("404s for another org's student and for unknown ids", async () => {
    const { agent } = await login();
    expect((await agent.get('/api/students/so1/profile')).status).toBe(404);
    expect((await agent.get('/api/students/nope/profile')).status).toBe(404);
    const out = await login('waiguo');
    expect((await out.agent.get('/api/students/s1/profile')).status).toBe(404);
  });

  it('derives header totals and per-session cells from the ledger, sessions in chronological order', async () => {
    addSession2();
    const { agent } = await login();
    const res = await agent.get('/api/students/s1/profile');
    expect(res.status).toBe(200);
    const p = res.body;

    expect(p.student).toMatchObject({ id: 's1', name: '小明', source: 'parent', status: 'active' });
    expect(p.class).toEqual({ id: 'c1', name: '三年级A班' });
    expect(p.currentGroup).toEqual({ name: '第1组', emoji: '🦁' });
    // 已上课 = present memberships; 总分/加星/扣分 only count student-target events
    expect(p.totals).toEqual({ attended: 2, personalTotal: 1, plus: 2, minus: 1 });

    expect(p.sessions.map((s: any) => s.id)).toEqual(['sess1', 'sess2']); // oldest → newest
    expect(p.sessions[0]).toMatchObject({ date: '06-26', lessonNumber: 7, lessonTitle: 'Too late' });
    expect(p.sessions[0].mine).toEqual({
      attended: true,
      groupName: '第1组',
      groupEmoji: '🦁',
      groupScore: 4, // nested: s1(+2) + s2(+1) + group event(+1)
      personalScore: 2,
      homework: '完成',
      recitation: '已背完',
    });
    expect(p.sessions[1].mine).toEqual({
      attended: true,
      groupName: '第1组',
      groupEmoji: '🦁',
      groupScore: -1,
      personalScore: -1,
      homework: '没交', // missing record → 没交
      recitation: '背完部分',
    });
  });

  it('applies the missing-record defaults: homework 没交, recitation 未检查', async () => {
    const { agent } = await login();
    const p = (await agent.get('/api/students/s3/profile')).body;
    expect(p.totals).toEqual({ attended: 1, personalTotal: 0, plus: 1, minus: 1 });
    expect(p.sessions[0].mine).toMatchObject({
      attended: true,
      personalScore: 0,
      homework: '没交',
      recitation: '未检查',
    });
  });

  it('keeps an explicit absence (attended:false, no group) distinct from 未入班 (mine:null)', async () => {
    addSession2();
    const { agent } = await login();
    // s4: absent in sess1 (membership row, no group), no membership at all in sess2
    const p4 = (await agent.get('/api/students/s4/profile')).body;
    expect(p4.currentGroup).toBeNull();
    expect(p4.totals.attended).toBe(0);
    expect(p4.sessions[0].mine).toMatchObject({ attended: false, groupName: null, groupScore: null });
    expect(p4.sessions[1].mine).toBeNull();
    // s2: absent in sess2 → still a mine card, just not attended
    const p2 = (await agent.get('/api/students/s2/profile')).body;
    expect(p2.totals.attended).toBe(1);
    expect(p2.sessions[1].mine).toMatchObject({ attended: false, groupName: null });
  });

  it('ignores ongoing sessions and serves students with no history (empty profile)', async () => {
    sqlite.exec(`
      INSERT INTO class_sessions (id, class_id, teacher_id, date, status, planned_duration_min)
      VALUES ('sess-live','c1','t-wangli','2026-07-04','ongoing',120);
    `);
    const { agent } = await login();
    const p = (await agent.get('/api/students/s1/profile')).body;
    expect(p.sessions.map((s: any) => s.id)).toEqual(['sess1']);

    const out = await login('waiguo');
    const empty = (await out.agent.get('/api/students/so1/profile')).body;
    expect(empty.sessions).toEqual([]);
    expect(empty.totals).toEqual({ attended: 0, personalTotal: 0, plus: 0, minus: 0 });
  });

  it('still serves archived students (history stays viewable)', async () => {
    const { agent } = await login();
    await agent.put('/api/students/s1/status').send({ status: 'archived' });
    const res = await agent.get('/api/students/s1/profile');
    expect(res.status).toBe(200);
    expect(res.body.student.status).toBe('archived');
    expect(res.body.currentGroup).toBeNull(); // archiving cleared the default grouping
    expect(res.body.sessions[0].mine.personalScore).toBe(2);
  });
});

describe('class attendance (考勤)', () => {
  /** Second ended session: s1/s3 present, s2 absent; s4 has NO membership row (未入班). */
  const addSession2 = () => {
    sqlite.exec(`
      INSERT INTO class_sessions (id, class_id, teacher_id, date, lesson_number, lesson_title, status, planned_duration_min, started_at, ended_at)
      VALUES ('sess2','c1','t-wangli','2026-07-03',8,'The best and the worst','ended',120,'2026-07-03 19:00:00','2026-07-03 21:00:00');
      INSERT INTO session_groups (id, session_id, name, emoji, order_index)
      VALUES ('sg3','sess2','第1组','🦁',0),('sg4','sess2','第2组','🐯',1);
      INSERT INTO session_memberships (id, session_id, student_id, session_group_id, attendance)
      VALUES ('sm2-s1','sess2','s1','sg3','present'),('sm2-s2','sess2','s2',NULL,'absent'),('sm2-s3','sess2','s3','sg4','present');
    `);
  };

  it('blocks unauthenticated access with 401', async () => {
    expect((await request(app).get('/api/classes/c1/attendance')).status).toBe(401);
    expect((await request(app).put('/api/sessions/sess1/attendance/s1').send({ status: 'absent' })).status).toBe(401);
  });

  it('returns ended sessions oldest→newest, the roster, and the record matrix', async () => {
    addSession2();
    sqlite.exec(`
      INSERT INTO class_sessions (id, class_id, teacher_id, date, status, planned_duration_min)
      VALUES ('sess-live','c1','t-wangli','2026-07-04','ongoing',120);
    `);
    const { agent } = await login();
    const res = await agent.get('/api/classes/c1/attendance');
    expect(res.status).toBe(200);
    const a = res.body;
    expect(a.classId).toBe('c1');
    expect(a.className).toBe('三年级A班');
    // ongoing session excluded; ended ones oldest first
    expect(a.sessions.map((s: any) => s.id)).toEqual(['sess1', 'sess2']);
    expect(a.sessions[0]).toMatchObject({ date: '2026-06-26', lessonNumber: 7, lessonTitle: 'Too late' });
    expect(a.students.map((s: any) => s.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(a.students[0]).toMatchObject({ name: '小明', status: 'active' });
    const rec = (sid: string, stid: string) => a.records.find((r: any) => r.sessionId === sid && r.studentId === stid);
    expect(rec('sess1', 's4')).toMatchObject({ status: 'absent', madeUp: false });
    expect(rec('sess1', 's1')).toMatchObject({ status: 'present', madeUp: false });
    expect(rec('sess2', 's4')).toBeUndefined(); // no membership row → 未入班 cell
  });

  it('excludes archived students but keeps suspended ones', async () => {
    const { agent } = await login();
    await agent.put('/api/students/s2/status').send({ status: 'suspended' });
    await agent.put('/api/students/s3/status').send({ status: 'archived' });
    const a = (await agent.get('/api/classes/c1/attendance')).body;
    expect(a.students.map((s: any) => [s.id, s.status])).toEqual([
      ['s1', 'active'],
      ['s2', 'suspended'],
      ['s4', 'active'],
    ]);
  });

  it("404s for another org's class", async () => {
    const { agent } = await login();
    expect((await agent.get('/api/classes/c-out/attendance')).status).toBe(404);
    const out = await login('waiguo');
    expect((await out.agent.get('/api/classes/c1/attendance')).status).toBe(404);
  });

  it('corrects a record to 请假 with makeup and reflects it in the matrix', async () => {
    const { agent } = await login();
    const res = await agent.put('/api/sessions/sess1/attendance/s4').send({ status: 'leave', madeUp: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionId: 'sess1', studentId: 's4', status: 'leave', madeUp: true });
    const a = (await agent.get('/api/classes/c1/attendance')).body;
    const r = a.records.find((x: any) => x.sessionId === 'sess1' && x.studentId === 's4');
    expect(r).toMatchObject({ status: 'leave', madeUp: true });
  });

  it('switching back to 到勤 clears the makeup flag', async () => {
    const { agent } = await login();
    await agent.put('/api/sessions/sess1/attendance/s4').send({ status: 'absent', madeUp: true });
    const res = await agent.put('/api/sessions/sess1/attendance/s4').send({ status: 'present', madeUp: true });
    expect(res.body).toMatchObject({ status: 'present', madeUp: false });
    const row = sqlite.prepare(`SELECT made_up FROM session_memberships WHERE id='sm-s4'`).get() as any;
    expect(row.made_up).toBe(0);
  });

  it('keeps the group snapshot intact when toggling status', async () => {
    const { agent } = await login();
    await agent.put('/api/sessions/sess1/attendance/s1').send({ status: 'absent' });
    await agent.put('/api/sessions/sess1/attendance/s1').send({ status: 'present' });
    const row = sqlite
      .prepare(`SELECT session_group_id, attendance FROM session_memberships WHERE id='sm-s1'`)
      .get() as any;
    expect(row).toEqual({ session_group_id: 'sg1', attendance: 'present' });
  });

  it('counts 请假 as not present in the recap attendance split', async () => {
    const { agent } = await login();
    await agent.put('/api/sessions/sess1/attendance/s1').send({ status: 'leave' });
    const recap = (await agent.get('/api/sessions/sess1/recap')).body;
    expect(recap.attendancePresent).toBe(2);
    expect(recap.attendanceTotal).toBe(4);
  });

  it('validates the status value (400)', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/sessions/sess1/attendance/s1').send({ status: 'late' })).status).toBe(400);
    expect((await agent.put('/api/sessions/sess1/attendance/s1').send({})).status).toBe(400);
  });

  it('404s when the student has no membership row in that session (未入班 cells stay locked)', async () => {
    addSession2();
    const { agent } = await login();
    // s4 never entered sess2's snapshot
    expect((await agent.put('/api/sessions/sess2/attendance/s4').send({ status: 'present' })).status).toBe(404);
  });

  it('404s for cross-org sessions and unknown ids', async () => {
    const out = await login('waiguo');
    expect((await out.agent.put('/api/sessions/sess1/attendance/s1').send({ status: 'present' })).status).toBe(404);
    const { agent } = await login();
    expect((await agent.put('/api/sessions/nope/attendance/s1').send({ status: 'present' })).status).toBe(404);
  });
});

describe('session deletion', () => {
  const childCount = (table: string, sid = 'sess1') =>
    (sqlite.prepare(`SELECT COUNT(*) c FROM ${table} WHERE session_id=?`).get(sid) as any).c;

  it('deletes the session and rolls back all of its ledger rows', async () => {
    const { agent } = await login();
    const res = await agent.delete('/api/sessions/sess1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const detail = (await agent.get('/api/classes/c1')).body;
    expect(detail.sessions.map((s: any) => s.id)).not.toContain('sess1');
    expect(detail.sessionCount).toBe(0);
    expect(detail.lastRecap).toBeNull(); // sess1 was the only ended session

    for (const t of ['score_events', 'session_memberships', 'check_records', 'session_groups', 'session_tags']) {
      expect(childCount(t)).toBe(0);
    }
    expect((sqlite.prepare(`SELECT COUNT(*) c FROM class_sessions WHERE id='sess1'`).get() as any).c).toBe(0);
  });

  it("blocks deleting another org's session with 404 and leaves the data intact", async () => {
    const { agent } = await login('waiguo'); // org-2 teacher
    expect((await agent.delete('/api/sessions/sess1')).status).toBe(404);
    expect(childCount('score_events')).toBeGreaterThan(0);
    expect((sqlite.prepare(`SELECT COUNT(*) c FROM class_sessions WHERE id='sess1'`).get() as any).c).toBe(1);
  });

  it('returns 404 for an unknown session id', async () => {
    const { agent } = await login();
    expect((await agent.delete('/api/sessions/nope')).status).toBe(404);
  });
});

describe('session start-time update', () => {
  const row = () =>
    sqlite.prepare(`SELECT date, started_at, ended_at FROM class_sessions WHERE id='sess1'`).get() as any;

  it('updates startedAt and recomputes the actual duration in classDetail', async () => {
    const { agent } = await login();
    const res = await agent.put('/api/sessions/sess1').send({ startedAt: '2026-06-26 18:30:00' });
    expect(res.status).toBe(200);
    // responds with the full session detail payload (same shape as GET /api/sessions/:id)
    expect(res.body).toMatchObject({ id: 'sess1', startedAt: '2026-06-26 18:30:00', classId: 'c1' });
    expect(row()).toMatchObject({ date: '2026-06-26', started_at: '2026-06-26 18:30:00' });

    const detail = (await agent.get('/api/classes/c1')).body;
    const s = detail.sessions.find((x: any) => x.id === 'sess1');
    expect(s.actualDurationMin).toBe(148); // 18:30 → 20:58
    expect(s.startedAt).toBe('2026-06-26 18:30:00');
    expect(s.endedAt).toBe('2026-06-26 20:58:00');
  });

  it('re-derives the session date when startedAt moves to another day', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/sessions/sess1').send({ startedAt: '2026-06-25 23:30:00' })).status).toBe(200);
    expect(row()).toMatchObject({ date: '2026-06-25', started_at: '2026-06-25 23:30:00' });
  });

  it('rejects malformed startedAt with 400 and leaves the row untouched', async () => {
    const { agent } = await login();
    for (const bad of ['2026-06-26T18:30:00Z', '18:30', '2026-13-99 99:99:99', '', null, 5]) {
      expect((await agent.put('/api/sessions/sess1').send({ startedAt: bad })).status).toBe(400);
    }
    expect(row()).toMatchObject({ date: '2026-06-26', started_at: '2026-06-26 19:00:00' });
  });

  it('rejects a startedAt at or after endedAt with 400', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/sessions/sess1').send({ startedAt: '2026-06-26 20:58:00' })).status).toBe(400);
    expect((await agent.put('/api/sessions/sess1').send({ startedAt: '2026-06-26 21:30:00' })).status).toBe(400);
    expect(row()).toMatchObject({ started_at: '2026-06-26 19:00:00' });
  });

  it("blocks unauthenticated (401), another org's session and unknown ids (404)", async () => {
    expect((await request(app).put('/api/sessions/sess1').send({ startedAt: '2026-06-26 18:30:00' })).status).toBe(401);
    const out = await login('waiguo'); // org-2 teacher
    expect((await out.agent.put('/api/sessions/sess1').send({ startedAt: '2026-06-26 18:30:00' })).status).toBe(404);
    const { agent } = await login();
    expect((await agent.put('/api/sessions/nope').send({ startedAt: '2026-06-26 18:30:00' })).status).toBe(404);
    expect(row()).toMatchObject({ started_at: '2026-06-26 19:00:00' });
  });
});

describe('session info edit (课堂信息 tab: 课次/课题/主讲老师)', () => {
  const row = () =>
    sqlite
      .prepare(`SELECT lesson_number, lesson_title, teacher_id, date, started_at FROM class_sessions WHERE id='sess1'`)
      .get() as any;

  it('updates 课次/课题/主讲老师/开始时间 in one PUT and echoes the detail payload', async () => {
    const { agent } = await login();
    await agent.post('/api/teachers').send({ name: '李芳', username: 'lifang', password: 'secret66' });
    const tid = (sqlite.prepare(`SELECT id FROM teachers WHERE username='lifang'`).get() as any).id;
    const res = await agent.put('/api/sessions/sess1').send({
      lessonNumber: 9,
      lessonTitle: 'A cold welcome',
      teacherId: tid,
      startedAt: '2026-06-26 18:00:00',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'sess1',
      lessonNumber: 9,
      lessonTitle: 'A cold welcome',
      teacherId: tid,
      teacherName: '李芳',
      startedAt: '2026-06-26 18:00:00',
    });
    expect(row()).toMatchObject({
      lesson_number: 9,
      lesson_title: 'A cold welcome',
      teacher_id: tid,
      started_at: '2026-06-26 18:00:00',
    });
  });

  it('is a partial update: absent keys keep their stored values', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/sessions/sess1').send({ lessonTitle: 'New title' })).status).toBe(200);
    expect(row()).toMatchObject({
      lesson_number: 7, // untouched
      lesson_title: 'New title',
      teacher_id: 't-wangli', // untouched
      started_at: '2026-06-26 19:00:00', // untouched
    });
  });

  it('clears 课次/课题/主讲老师 with explicit nulls; blank title also stores null', async () => {
    const { agent } = await login();
    const res = await agent.put('/api/sessions/sess1').send({ lessonNumber: null, lessonTitle: '  ', teacherId: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lessonNumber: null, lessonTitle: null, teacherId: null, teacherName: null });
    expect(row()).toMatchObject({ lesson_number: null, lesson_title: null, teacher_id: null });
  });

  it('rejects a non-positive-integer 课次号 with 400', async () => {
    const { agent } = await login();
    for (const bad of [0, -1, 1.5, '4']) {
      expect((await agent.put('/api/sessions/sess1').send({ lessonNumber: bad })).status).toBe(400);
    }
    expect(row()).toMatchObject({ lesson_number: 7 });
  });

  it('rejects a cross-org or unknown 主讲老师 with 400', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/sessions/sess1').send({ teacherId: 't-out' })).status).toBe(400);
    expect((await agent.put('/api/sessions/sess1').send({ teacherId: 'nope' })).status).toBe(400);
    expect(row()).toMatchObject({ teacher_id: 't-wangli' });
  });

  it('accepts an empty body as a no-op', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/sessions/sess1').send({})).status).toBe(200);
    expect(row()).toMatchObject({ lesson_number: 7, lesson_title: 'Too late', teacher_id: 't-wangli' });
  });
});

describe('end-class commit', () => {
  // Base payload over the seeded c1 (s1,s2 in g1; s3 in g2; s4 ungrouped).
  // Ledger: 小明 +2 (star), 小红 +1−1 (net 0, warned), 组 g1 +1 → g1 nested = 3.
  function body(over: Record<string, any> = {}) {
    return {
      clientSessionId: 'cs-1',
      lessonNumber: 8,
      lessonTitle: 'New lesson',
      plannedDurationMin: 120,
      startedAt: '2026-07-02 19:00:00',
      endedAt: '2026-07-02 20:00:00',
      defaultGrouping: {
        groups: [
          { clientId: 'g1', name: '第1组', emoji: '🦁', orderIndex: 0, memberIds: ['s1', 's2'] },
          { clientId: 'g2', name: '第2组', emoji: '🐯', orderIndex: 1, memberIds: ['s3'] },
        ],
      },
      sessionGroups: [
        { clientId: 'g1', name: '第1组', emoji: '🦁', orderIndex: 0 },
        { clientId: 'g2', name: '第2组', emoji: '🐯', orderIndex: 1 },
      ],
      memberships: [
        { studentId: 's1', clientGroupId: 'g1', attendance: 'present' },
        { studentId: 's2', clientGroupId: 'g1', attendance: 'present' },
        { studentId: 's3', clientGroupId: null, attendance: 'absent' },
        { studentId: 's4', clientGroupId: null, attendance: 'absent' },
      ],
      events: [
        { targetType: 'student', targetId: 's1', clientGroupId: 'g1', delta: 1, createdAt: '2026-07-02 19:05:00' },
        { targetType: 'student', targetId: 's1', clientGroupId: 'g1', delta: 1, createdAt: '2026-07-02 19:06:00' },
        { targetType: 'student', targetId: 's2', clientGroupId: 'g1', delta: 1, createdAt: '2026-07-02 19:07:00' },
        { targetType: 'student', targetId: 's2', clientGroupId: 'g1', delta: -1, createdAt: '2026-07-02 19:08:00' },
        { targetType: 'group', targetId: 'g1', clientGroupId: 'g1', delta: 1, createdAt: '2026-07-02 19:09:00' },
      ],
      checks: [
        { studentId: 's1', type: 'recitation', status: '已背完' },
        { studentId: 's1', type: 'homework', status: '完成' },
      ],
      ...over,
    };
  }

  it('persists the session + snapshots and returns a derived recap', async () => {
    const { agent } = await login();
    const res = await agent.post('/api/classes/c1/sessions').send(body());
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(typeof res.body.sessionId).toBe('string');

    // recap derived from the just-written ledger
    expect(res.body.recap.groups.map((g: any) => [g.name, g.score])).toEqual([
      ['第1组', 3],
      ['第2组', 0],
    ]);
    expect(res.body.recap.stars.map((s: any) => s.name)).toEqual(['小明']);
    expect(res.body.recap.warned.map((s: any) => s.name)).toEqual(['小红']);
    expect(res.body.recap.attendancePresent).toBe(2);
    expect(res.body.recap.attendanceTotal).toBe(4);

    const row = sqlite.prepare(`SELECT * FROM class_sessions WHERE client_session_id='cs-1'`).get() as any;
    expect(row.status).toBe('ended');
    expect(row.date).toBe('2026-07-02'); // decision 9: derived from startedAt
    expect(row.lesson_number).toBe(8);
    const sg = sqlite.prepare(`SELECT COUNT(*) c FROM session_groups WHERE session_id=?`).get(row.id) as any;
    const sm = sqlite.prepare(`SELECT COUNT(*) c FROM session_memberships WHERE session_id=?`).get(row.id) as any;
    const absent = sqlite
      .prepare(`SELECT session_group_id FROM session_memberships WHERE session_id=? AND student_id='s3'`)
      .get(row.id) as any;
    expect(sg.c).toBe(2);
    expect(sm.c).toBe(4);
    expect(absent.session_group_id).toBe(null); // decision 8

    // actual minutes = ended − started = 60
    const detail = (await agent.get('/api/classes/c1')).body;
    const s = detail.sessions.find((x: any) => x.id === row.id);
    expect(s.actualDurationMin).toBe(60);
    // 主讲老师 defaults to the committing teacher and surfaces in the list
    expect(row.teacher_id).toBe('t-wangli');
    expect(s.teacherName).toBe('王莉');
  });

  it('stores the chosen 主讲老师 when a same-org teacherId is sent', async () => {
    const { agent } = await login();
    await agent.post('/api/teachers').send({ name: '李芳', username: 'lifang', password: 'secret66' });
    const tid = (sqlite.prepare(`SELECT id FROM teachers WHERE username='lifang'`).get() as any).id;
    const res = await agent.post('/api/classes/c1/sessions').send(body({ clientSessionId: 'cs-t1', teacherId: tid }));
    expect(res.status).toBe(201);
    const row = sqlite.prepare(`SELECT teacher_id FROM class_sessions WHERE client_session_id='cs-t1'`).get() as any;
    expect(row.teacher_id).toBe(tid);
    const detail = (await agent.get('/api/classes/c1')).body;
    expect(detail.sessions.find((x: any) => x.id === res.body.sessionId).teacherName).toBe('李芳');
  });

  it('persists 奖章 tags, upserts the org library, and groups them in the recap', async () => {
    const { agent } = await login();
    const res = await agent.post('/api/classes/c1/sessions').send(
      body({
        clientSessionId: 'cs-tags',
        tags: [
          { studentId: 's1', tag: '听写全对' },
          { studentId: 's1', tag: '默写全对' },
          { studentId: 's2', tag: '听写全对' },
          { studentId: 's1', tag: '进步之星' }, // library hit: seeded tag1 must be reused, not duplicated
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.recap.studentTags).toEqual([
      { name: '小明', tags: ['听写全对', '默写全对', '进步之星'] },
      { name: '小红', tags: ['听写全对'] },
    ]);

    const rows = sqlite
      .prepare(`SELECT student_id, tag_id, tag_name FROM session_tags WHERE session_id=? ORDER BY rowid`)
      .all(res.body.sessionId) as any[];
    expect(rows.map((r) => [r.student_id, r.tag_name])).toEqual([
      ['s1', '听写全对'],
      ['s1', '默写全对'],
      ['s2', '听写全对'],
      ['s1', '进步之星'],
    ]);
    // library: 2 new names minted once each, 进步之星 reused (still tag1)
    const lib = sqlite.prepare(`SELECT id, name FROM org_tags WHERE org_id='org-1' ORDER BY rowid`).all() as any[];
    expect(lib.map((t) => t.name).sort()).toEqual(['听写全对', '进步之星', '默写全对'].sort());
    expect(rows.find((r) => r.tag_name === '进步之星').tag_id).toBe('tag1');
    // both students awarded 听写全对 point at the same library row
    const dictation = rows.filter((r) => r.tag_name === '听写全对');
    expect(dictation[0].tag_id).toBe(dictation[1].tag_id);
  });

  it('upserts the tag library idempotently across commits', async () => {
    const { agent } = await login();
    const send = (csid: string) =>
      agent
        .post('/api/classes/c1/sessions')
        .send(body({ clientSessionId: csid, tags: [{ studentId: 's1', tag: '课堂之星' }] }));
    expect((await send('cs-up-1')).status).toBe(201);
    expect((await send('cs-up-2')).status).toBe(201);
    const c = sqlite.prepare(`SELECT COUNT(*) c FROM org_tags WHERE org_id='org-1' AND name='课堂之星'`).get() as any;
    expect(c.c).toBe(1);
  });

  it('tag 宽松校验: salvages what it can and never fails the commit over a bad tag entry', async () => {
    const { agent } = await login();
    const res = await agent.post('/api/classes/c1/sessions').send(
      body({
        clientSessionId: 'cs-tags-dirty',
        tags: [
          { studentId: 'so1', tag: '外校学生' }, // foreign student → dropped, not 400
          { studentId: 'ghost', tag: '查无此人' }, // deleted student → dropped
          { studentId: 's1', tag: '   ' }, // blank tag → dropped
          { studentId: 's1' }, // missing tag → dropped
          { tag: '没有学生' }, // missing studentId → dropped
          { studentId: 's1', tag: '  空白  归一化  ' }, // whitespace collapsed
          { studentId: 's1', tag: '空白 归一化' }, // dup after normalisation → dropped
          { studentId: 's1', tag: 'x'.repeat(40) }, // over-long → truncated to 20
          { studentId: 's2', tag: 'y'.repeat(19) + ' z' }, // cut lands on a space → re-trimmed
        ],
      }),
    );
    expect(res.status).toBe(201);
    const rows = sqlite
      .prepare(`SELECT tag_name FROM session_tags WHERE session_id=? ORDER BY rowid`)
      .all(res.body.sessionId) as any[];
    expect(rows.map((r) => r.tag_name)).toEqual(['空白 归一化', 'x'.repeat(20), 'y'.repeat(19)]);
  });

  it('rejects a cross-org or unknown 主讲老师 with 400 and stores nothing', async () => {
    const { agent } = await login();
    expect((await agent.post('/api/classes/c1/sessions').send(body({ teacherId: 't-out' }))).status).toBe(400);
    expect((await agent.post('/api/classes/c1/sessions').send(body({ teacherId: 'nope' }))).status).toBe(400);
    const c = sqlite.prepare(`SELECT COUNT(*) c FROM class_sessions WHERE client_session_id='cs-1'`).get() as any;
    expect(c.c).toBe(0);
  });

  // 手动记录课堂 (backfill): the web commits a PAST startedAt + endedAt=startedAt+时长,
  // while events recorded live-today carry a createdAt well outside that window.
  // This locks in that the commit path needs no server change — no "not in the
  // past" guard, no event-createdAt bounds check — and that date derives from the
  // backfilled startedAt. If this fails, someone tightened buildCommitInput.
  it('手动记录课堂: a past-dated commit lands with a derived past date, events outside the window accepted', async () => {
    const { agent } = await login();
    const res = await agent.post('/api/classes/c1/sessions').send(
      body({
        clientSessionId: 'cs-backfill',
        startedAt: '2025-03-10 14:00:00',
        endedAt: '2025-03-10 16:00:00', // = startedAt + 120 分钟, as the 补录 flow computes
        events: [
          // recorded 补录-today: createdAt is long after endedAt — must NOT be rejected
          { targetType: 'student', targetId: 's1', clientGroupId: 'g1', delta: 1, createdAt: '2026-07-05 10:00:00' },
          { targetType: 'group', targetId: 'g1', clientGroupId: 'g1', delta: 1, createdAt: '2026-07-05 10:00:01' },
        ],
        checks: [],
      }),
    );
    expect(res.status).toBe(201);
    const row = sqlite.prepare(`SELECT * FROM class_sessions WHERE client_session_id='cs-backfill'`).get() as any;
    expect(row.date).toBe('2025-03-10'); // derived from the backfilled startedAt, not "today"
    const detail = (await agent.get('/api/classes/c1')).body;
    const s = detail.sessions.find((x: any) => x.id === row.id);
    expect(s.actualDurationMin).toBe(120); // endedAt − startedAt survives verbatim
  });

  // ---- schema 向后兼容 (protobuf-style; guards buildCommitInput's contract) --
  // 课堂进行中服务端可能发新版：旧页面攒了一整节课的数据，提交的是旧 shape 的
  // payload。这两条用例守住演进纪律——旧 payload 永远能入库、未知字段永远被忽略。
  // 若某次改动让它们挂了，说明 commit 契约被破坏（加了必填字段/收紧了校验），
  // 改服务端而不是改测试。

  it('向后兼容: accepts a payload with every optional field absent (old-client shape)', async () => {
    const { agent } = await login();
    const res = await agent.post('/api/classes/c1/sessions').send({
      // only fields that were required since the FIRST classroom release
      clientSessionId: 'cs-old-shape',
      startedAt: '2026-07-02 19:00:00',
      endedAt: '2026-07-02 20:00:00',
      defaultGrouping: { groups: [{ clientId: 'g1', name: '第1组', memberIds: ['s1', 's2'] }] },
      sessionGroups: [{ clientId: 'g1', name: '第1组' }], // no emoji / orderIndex
      memberships: [{ studentId: 's1', clientGroupId: 'g1' }], // no attendance
      events: [{ targetType: 'student', targetId: 's1', clientGroupId: 'g1', delta: 1 }], // no createdAt
      // no lessonNumber / lessonTitle / plannedDurationMin / teacherId / checks
    });
    expect(res.status).toBe(201);
    const row = sqlite.prepare(`SELECT * FROM class_sessions WHERE client_session_id='cs-old-shape'`).get() as any;
    // every missing optional field lands on its documented default
    expect(row.lesson_number).toBe(null);
    expect(row.lesson_title).toBe(null);
    expect(row.planned_duration_min).toBe(120);
    expect(row.teacher_id).toBe('t-wangli'); // committing teacher fallback
    const ev = sqlite.prepare(`SELECT created_at FROM score_events WHERE session_id=?`).get(row.id) as any;
    expect(ev.created_at).toBe('2026-07-02 19:00:00'); // createdAt falls back to startedAt
    const mem = sqlite
      .prepare(`SELECT attendance FROM session_memberships WHERE session_id=? AND student_id='s1'`)
      .get(row.id) as any;
    expect(mem.attendance).toBe('present');
  });

  it('向前兼容: silently ignores unknown fields at every level (newer-client payload)', async () => {
    const { agent } = await login();
    const b = body({ clientSessionId: 'cs-future' }) as any;
    // sprinkle未来版本可能新增的字段 into every nesting level
    b.futureTopLevel = { nested: true };
    b.appVersion = '9.9.9';
    b.defaultGrouping.futureFlag = 1;
    b.defaultGrouping.groups[0].color = 'red';
    b.sessionGroups[0].mascotUrl = 'https://x/y.png';
    b.memberships[0].mood = 'happy';
    b.events[0].source = 'stylus';
    b.checks[0].gradedBy = 'ai';
    b.tags = [{ studentId: 's1', tag: '认真', sticker: '🌟' }]; // unknown subfield ignored, tag kept
    const res = await agent.post('/api/classes/c1/sessions').send(b);
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    const row = sqlite.prepare(`SELECT * FROM class_sessions WHERE client_session_id='cs-future'`).get() as any;
    expect(row.status).toBe('ended'); // stored exactly as the known fields describe
    expect(row.lesson_number).toBe(8);
    const tag = sqlite.prepare(`SELECT tag_name FROM session_tags WHERE session_id=?`).get(row.id) as any;
    expect(tag.tag_name).toBe('认真');
  });

  it('writes back the default grouping (open-time), keeping absent students + minting new-group ids', async () => {
    const { agent } = await login();
    // 小刚 (s3) is absent yet kept in a brand-new group; 小明/小红 stay in g1.
    await agent.post('/api/classes/c1/sessions').send(
      body({
        clientSessionId: 'cs-dg',
        defaultGrouping: {
          groups: [
            { clientId: 'g1', name: '第1组', emoji: '🦁', orderIndex: 0, memberIds: ['s1', 's2'] },
            { clientId: 'new-z', name: '新小组', emoji: '🐼', orderIndex: 1, memberIds: ['s3'] },
          ],
        },
      }),
    );
    const detail = (await agent.get('/api/classes/c1')).body;
    expect(detail.groups.find((g: any) => g.id === 'g1').memberIds.sort()).toEqual(['s1', 's2']);
    const fresh = detail.groups.find((g: any) => g.name === '新小组');
    expect(fresh.id).not.toBe('new-z'); // minted a real id
    expect(fresh.memberIds).toEqual(['s3']); // absent 小刚 kept in default (decision 6)
    expect(detail.groups.map((g: any) => g.id)).not.toContain('g2'); // g2 replaced
    // s4 stays ungrouped
    expect(detail.students.find((s: any) => s.id === 's4').groupId).toBe(null);
  });

  it('attributes each score event to the group at event time, not the final membership', async () => {
    const { agent } = await login();
    // 小明 earns once in g1, then is re-grouped to g2 and earns once more there.
    const res = await agent.post('/api/classes/c1/sessions').send(
      body({
        clientSessionId: 'cs-move',
        memberships: [
          { studentId: 's1', clientGroupId: 'g2', attendance: 'present' }, // final group g2
          { studentId: 's2', clientGroupId: 'g1', attendance: 'present' },
          { studentId: 's3', clientGroupId: 'g2', attendance: 'present' },
          { studentId: 's4', clientGroupId: null, attendance: 'absent' },
        ],
        events: [
          { targetType: 'student', targetId: 's1', clientGroupId: 'g1', delta: 1, createdAt: '2026-07-02 19:05:00' },
          { targetType: 'student', targetId: 's1', clientGroupId: 'g2', delta: 1, createdAt: '2026-07-02 19:20:00' },
        ],
        checks: [],
      }),
    );
    const byName = new Map(res.body.recap.groups.map((g: any) => [g.name, g.score]));
    expect(byName.get('第1组')).toBe(1); // historical g1 point kept
    expect(byName.get('第2组')).toBe(1); // post-move point
  });

  it('is idempotent for a repeated clientSessionId', async () => {
    const { agent } = await login();
    const first = await agent.post('/api/classes/c1/sessions').send(body({ clientSessionId: 'cs-dup' }));
    const second = await agent.post('/api/classes/c1/sessions').send(body({ clientSessionId: 'cs-dup' }));
    expect(first.body.created).toBe(true);
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.sessionId).toBe(first.body.sessionId);
    const count = sqlite.prepare(`SELECT COUNT(*) c FROM class_sessions WHERE client_session_id='cs-dup'`).get() as any;
    expect(count.c).toBe(1);
  });

  it('frees the clientSessionId when the session is deleted — a retry re-creates it', async () => {
    const { agent } = await login();
    const first = await agent.post('/api/classes/c1/sessions').send(body({ clientSessionId: 'cs-del' }));
    expect(first.body.created).toBe(true);
    expect((await agent.delete(`/api/sessions/${first.body.sessionId}`)).status).toBe(200);

    const retry = await agent.post('/api/classes/c1/sessions').send(body({ clientSessionId: 'cs-del' }));
    expect(retry.status).toBe(201);
    expect(retry.body.created).toBe(true);
    expect(retry.body.sessionId).not.toBe(first.body.sessionId);
  });

  it('rejects malformed payloads and foreign ids', async () => {
    const { agent } = await login();
    // ISO time string would make actualMin NaN
    expect(
      (await agent.post('/api/classes/c1/sessions').send(body({ startedAt: '2026-07-02T19:00:00Z' }))).status,
    ).toBe(400);
    // delta must be ±1
    expect(
      (
        await agent.post('/api/classes/c1/sessions').send(
          body({
            events: [
              {
                targetType: 'student',
                targetId: 's1',
                clientGroupId: 'g1',
                delta: 2,
                createdAt: '2026-07-02 19:05:00',
              },
            ],
          }),
        )
      ).status,
    ).toBe(400);
    // membership for a FOREIGN student (belongs to another class) is rejected
    expect(
      (
        await agent
          .post('/api/classes/c1/sessions')
          .send(body({ memberships: [{ studentId: 'so1', clientGroupId: null, attendance: 'present' }] }))
      ).status,
    ).toBe(400);
    // out-of-range time value (crafted) is rejected, not stored as NaN duration (L2)
    expect((await agent.post('/api/classes/c1/sessions').send(body({ startedAt: '2026-13-99 99:99:99' }))).status).toBe(
      400,
    );
  });

  it('scopes idempotency to the class — no cross-org recap leak (H1)', async () => {
    const { agent } = await login(); // 王莉, org-1
    await agent.post('/api/classes/c1/sessions').send(body({ clientSessionId: 'shared-key' }));

    const out = (await login('waiguo', 'demo1234')).agent; // 外老师, org-2, owns c-out
    const res = await out.post('/api/classes/c-out/sessions').send({
      clientSessionId: 'shared-key', // same key, different class/org
      startedAt: '2026-07-02 19:00:00',
      endedAt: '2026-07-02 20:00:00',
      plannedDurationMin: 120,
      defaultGrouping: { groups: [] },
      sessionGroups: [],
      memberships: [],
      events: [],
      checks: [],
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain('小明'); // org-1 student names must not leak
  });

  it('rejects a defaultGrouping clientId that is not one of this class’s own groups (M1)', async () => {
    const { agent } = await login();
    const res = await agent.post('/api/classes/c1/sessions').send(
      body({
        clientSessionId: 'cs-m1',
        defaultGrouping: {
          groups: [{ clientId: 'foreign-gid', name: 'X', emoji: null, orderIndex: 0, memberIds: [] }],
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('refuses to wipe the class default grouping when defaultGrouping is missing (M2)', async () => {
    const { agent } = await login();
    const { defaultGrouping, ...noDg } = body({ clientSessionId: 'cs-m2' });
    void defaultGrouping;
    const res = await agent.post('/api/classes/c1/sessions').send(noDg);
    expect(res.status).toBe(400);
    const detail = (await agent.get('/api/classes/c1')).body;
    expect(detail.groups.map((g: any) => g.id).sort()).toEqual(['g1', 'g2']); // grouping intact
  });

  it('drops rows for a student deleted mid-class instead of failing the whole commit (M4)', async () => {
    const { agent } = await login();
    await agent.delete('/api/students/s2'); // removed from roster while "class" is running
    const res = await agent.post('/api/classes/c1/sessions').send(body({ clientSessionId: 'cs-m4' }));
    expect(res.status).toBe(201);
    const row = sqlite.prepare(`SELECT id FROM class_sessions WHERE client_session_id='cs-m4'`).get() as any;
    const s2mem = sqlite
      .prepare(`SELECT COUNT(*) c FROM session_memberships WHERE session_id=? AND student_id='s2'`)
      .get(row.id) as any;
    const s2ev = sqlite
      .prepare(`SELECT COUNT(*) c FROM score_events WHERE session_id=? AND target_id='s2'`)
      .get(row.id) as any;
    expect(s2mem.c).toBe(0);
    expect(s2ev.c).toBe(0);
  });
});

describe('student status', () => {
  it('suspends a student: membership cleared, class count unchanged', async () => {
    const { agent } = await login();
    const res = await agent.put('/api/students/s1/status').send({ status: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 's1', status: 'suspended' });

    expect((sqlite.prepare(`SELECT status FROM students WHERE id='s1'`).get() as any).status).toBe('suspended');
    const mem = sqlite.prepare(`SELECT COUNT(*) c FROM class_group_memberships WHERE student_id='s1'`).get() as any;
    expect(mem.c).toBe(0);

    const detail = (await agent.get('/api/classes/c1')).body;
    expect(detail.studentCount).toBe(4); // 在读+停课 both count
    expect(detail.students.find((s: any) => s.id === 's1')).toMatchObject({ status: 'suspended', groupId: null });
    expect(detail.groups.find((g: any) => g.id === 'g1').memberIds).toEqual(['s2']);
  });

  it('archives a student: out of counts + roster preview, still in the detail list', async () => {
    const { agent } = await login();
    await agent.put('/api/students/s1/status').send({ status: 'archived' });

    const c1 = (await agent.get('/api/classes')).body.find((c: any) => c.id === 'c1');
    expect(c1.studentCount).toBe(3);
    expect(c1.roster).not.toContain('小明');

    const detail = (await agent.get('/api/classes/c1')).body;
    expect(detail.studentCount).toBe(3);
    expect(detail.students.find((s: any) => s.id === 's1')).toMatchObject({ status: 'archived' });
  });

  it('restores to active without restoring the grouping', async () => {
    const { agent } = await login();
    await agent.put('/api/students/s1/status').send({ status: 'suspended' });
    const res = await agent.put('/api/students/s1/status').send({ status: 'active' });
    expect(res.status).toBe(200);
    const detail = (await agent.get('/api/classes/c1')).body;
    expect(detail.students.find((s: any) => s.id === 's1')).toMatchObject({ status: 'active', groupId: null });
  });

  it('rejects bogus values, unknown ids and cross-org students', async () => {
    const { agent } = await login();
    expect((await agent.put('/api/students/s1/status').send({ status: 'gone' })).status).toBe(400);
    expect((await agent.put('/api/students/nope/status').send({ status: 'archived' })).status).toBe(404);

    const out = (await login('waiguo')).agent;
    expect((await out.put('/api/students/s1/status').send({ status: 'archived' })).status).toBe(404);
    expect((sqlite.prepare(`SELECT status FROM students WHERE id='s1'`).get() as any).status).toBe('active');
  });

  it('filters suspended students out of a saved grouping', async () => {
    const { agent } = await login();
    await agent.put('/api/students/s2/status').send({ status: 'suspended' });
    const res = await agent.put('/api/classes/c1/groups').send({
      groups: [{ id: 'g1', name: '第1组', emoji: '🦁', orderIndex: 0, memberIds: ['s1', 's2'] }],
    });
    expect(res.status).toBe(200);
    expect(res.body.groups.find((g: any) => g.id === 'g1').memberIds).toEqual(['s1']);
    const mem = sqlite.prepare(`SELECT COUNT(*) c FROM class_group_memberships WHERE student_id='s2'`).get() as any;
    expect(mem.c).toBe(0);
  });

  it('keeps a mid-class-suspended student in the session snapshot but not the grouping writeback', async () => {
    const { agent } = await login();
    await agent.put('/api/students/s2/status').send({ status: 'suspended' });
    // commit payload built before the suspension still references s2 everywhere
    const res = await agent.post('/api/classes/c1/sessions').send({
      clientSessionId: 'cs-status',
      lessonNumber: 8,
      lessonTitle: 'X',
      plannedDurationMin: 120,
      startedAt: '2026-07-02 19:00:00',
      endedAt: '2026-07-02 20:00:00',
      defaultGrouping: {
        groups: [
          { clientId: 'g1', name: '第1组', emoji: '🦁', orderIndex: 0, memberIds: ['s1', 's2'] },
          { clientId: 'g2', name: '第2组', emoji: '🐯', orderIndex: 1, memberIds: ['s3'] },
        ],
      },
      sessionGroups: [
        { clientId: 'g1', name: '第1组', emoji: '🦁', orderIndex: 0 },
        { clientId: 'g2', name: '第2组', emoji: '🐯', orderIndex: 1 },
      ],
      memberships: [
        { studentId: 's1', clientGroupId: 'g1', attendance: 'present' },
        { studentId: 's2', clientGroupId: 'g1', attendance: 'present' },
        { studentId: 's3', clientGroupId: 'g2', attendance: 'present' },
      ],
      events: [
        { targetType: 'student', targetId: 's2', clientGroupId: 'g1', delta: 1, createdAt: '2026-07-02 19:05:00' },
      ],
      checks: [],
    });
    expect(res.status).toBe(201);
    const row = sqlite.prepare(`SELECT id FROM class_sessions WHERE client_session_id='cs-status'`).get() as any;
    const sm = sqlite
      .prepare(`SELECT COUNT(*) c FROM session_memberships WHERE session_id=? AND student_id='s2'`)
      .get(row.id) as any;
    const ev = sqlite
      .prepare(`SELECT COUNT(*) c FROM score_events WHERE session_id=? AND target_id='s2'`)
      .get(row.id) as any;
    const cgm = sqlite.prepare(`SELECT COUNT(*) c FROM class_group_memberships WHERE student_id='s2'`).get() as any;
    expect(sm.c).toBe(1);
    expect(ev.c).toBe(1);
    expect(cgm.c).toBe(0);
  });
});

describe('student status (wx)', () => {
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('archiving hides the student from teacher-side wx lists but keeps the parent view', async () => {
    const { agent } = await login();
    await agent.put('/api/students/s1/status').send({ status: 'archived' });

    const teacherToken = await wxLogin(app, 'dev-teacher');
    const classes = await request(app).get('/api/wx/teacher/classes').set(auth(teacherToken));
    expect(classes.body.find((c: any) => c.id === 'c1').studentCount).toBe(3);
    const candidates = await request(app).get('/api/wx/teacher/classes/c1/students').set(auth(teacherToken));
    expect(candidates.body.map((s: any) => s.id)).not.toContain('s1');

    // dev-parent is bound to s1: children list + recap stay intact
    const parentToken = await wxLogin(app, 'dev-parent');
    const me = await request(app).get('/api/wx/me').set(auth(parentToken));
    expect(me.body.children.map((c: any) => c.studentId)).toContain('s1');
    expect((await request(app).get('/api/wx/students/s1').set(auth(parentToken))).status).toBe(200);
    const recap = await request(app).get('/api/wx/students/s1/sessions/sess1').set(auth(parentToken));
    expect(recap.status).toBe(200);
    expect(recap.body.mine).toMatchObject({ attended: true, personalScore: 2, tags: ['进步之星'] });
    expect(recap.body.studentTags).toEqual([{ name: '小明', tags: ['进步之星'] }]);
  });

  it('invite preview count excludes archived; linking to an archived student is 400', async () => {
    const { agent } = await login();
    const teacherToken = await wxLogin(app, 'dev-teacher');
    const inviteToken = (await request(app).post('/api/wx/teacher/classes/c1/invites').set(auth(teacherToken))).body
      .token;

    const newToken = await wxLogin(app, 'dev-new');
    expect((await request(app).get(`/api/wx/invites/${inviteToken}`).set(auth(newToken))).body.studentCount).toBe(4);

    await agent.put('/api/students/s1/status').send({ status: 'archived' });
    expect((await request(app).get(`/api/wx/invites/${inviteToken}`).set(auth(newToken))).body.studentCount).toBe(3);

    const join = await request(app)
      .post(`/api/wx/invites/${inviteToken}/join`)
      .set(auth(newToken))
      .send({ cnName: '新娃' });
    expect(join.status).toBe(201);
    const link = await request(app)
      .post(`/api/wx/join-requests/${join.body.id}/link`)
      .set(auth(teacherToken))
      .send({ studentId: 's1' });
    expect(link.status).toBe(400);

    // a suspended student can still be linked
    await agent.put('/api/students/s2/status').send({ status: 'suspended' });
    const link2 = await request(app)
      .post(`/api/wx/join-requests/${join.body.id}/link`)
      .set(auth(teacherToken))
      .send({ studentId: 's2' });
    expect(link2.status).toBe(200);
  });
});

describe('cross-org isolation', () => {
  it("hides another org's class and blocks writes to it", async () => {
    const { agent } = await login(); // 王莉 in org-1
    expect((await agent.get('/api/classes/c-out')).status).toBe(404);
    expect((await agent.post('/api/classes/c-out/students').send({ name: 'x' })).status).toBe(404);
    expect((await agent.delete('/api/students/so1')).status).toBe(404);
    expect((await agent.put('/api/classes/c-out/groups').send({ groups: [] })).status).toBe(404);
    expect((await agent.post('/api/classes/c-out/sessions').send({ clientSessionId: 'x' })).status).toBe(404);
  });
});
