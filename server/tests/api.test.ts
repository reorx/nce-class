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
