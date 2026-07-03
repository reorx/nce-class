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

    for (const t of ['score_events', 'session_memberships', 'check_records', 'session_groups']) {
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
    expect(recap.body.mine).toMatchObject({ attended: true, personalScore: 2 });
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
