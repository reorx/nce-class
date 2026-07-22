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

async function login(username = 'wangli', password = 'demo1234') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password });
  return { agent, res };
}

// 计费口径用真实本地日期切分（生产路径 today = new Date()），测试里的日期
// 一律相对今天推算，保证任何一天跑都稳定。
const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return fmtDate(d);
};

/** 默认周期：过去 3 节（D-6/D-4/D-2）+ 未来 2 节（D+2/D+4），18:00–20:00。 */
const LESSONS = [day(-6), day(-4), day(-2), day(2), day(4)].map((date) => ({
  date,
  startTime: '18:00',
  endTime: '20:00',
}));

async function createSchedule(agent: request.Agent, lessons = LESSONS, name = '七月周期') {
  const res = await agent.post('/api/classes/c1/schedules').send({ name, lessons });
  expect(res.status).toBe(201);
  return res.body;
}

/** 直插一节已结束课堂 + 出勤快照（sess 维度的最小可计费数据）。 */
function insertSession(id: string, date: string, atts: Record<string, { attendance: string; madeUp?: number }>) {
  sqlite
    .prepare(
      `INSERT INTO class_sessions (id, class_id, teacher_id, date, status, planned_duration_min, started_at, ended_at)
       VALUES (?,?,?,?, 'ended', 120, ?, ?)`,
    )
    .run(id, 'c1', 't-wangli', date, `${date} 18:00:00`, `${date} 20:00:00`);
  for (const [sid, a] of Object.entries(atts)) {
    sqlite
      .prepare(
        `INSERT INTO session_memberships (id, session_id, student_id, session_group_id, attendance, made_up)
         VALUES (?,?,?,NULL,?,?)`,
      )
      .run(`bm-${id}-${sid}`, id, sid, a.attendance, a.madeUp ?? 0);
  }
}

/**
 * 标准计费现场（今天 = D0）：
 * - 周期 5 节：D-6 / D-4 / D-2 / D+2 / D+4（D-2 没开课 → 临时取消不收钱）
 * - 实际课堂：A@D-6、B@D-4、C@D-5（排班外临时加课，计入）
 * - s1 全勤 3 节 + 未来 2 → billable 5
 * - s2 A 缺席已补、B 请假未补、C 缺席 → 到堂 1 + 未来 2 → 3
 * - s3 中途入班（A 无快照行）、B/C 到堂 → 2 + 2 → 4
 * - s4 停课：A 到堂 → 1 + planned 0 → 1
 * - s5 归档且没上过 → 不建单
 */
function seedBillingScene() {
  insertSession('bA', day(-6), {
    s1: { attendance: 'present' },
    s2: { attendance: 'absent', madeUp: 1 },
    s4: { attendance: 'present' },
  });
  insertSession('bB', day(-4), {
    s1: { attendance: 'present' },
    s2: { attendance: 'leave' },
    s3: { attendance: 'present' },
    s4: { attendance: 'absent' },
  });
  insertSession('bC', day(-5), {
    s1: { attendance: 'present' },
    s2: { attendance: 'absent' },
    s3: { attendance: 'present' },
    s4: { attendance: 'absent' },
  });
  sqlite.prepare(`UPDATE students SET status='suspended' WHERE id='s4'`).run();
  sqlite
    .prepare(
      `INSERT INTO students (id, class_id, name, source, status, recap_token) VALUES ('s5','c1','旧生','teacher','archived','tok-s5')`,
    )
    .run();
}

async function createBatch(agent: request.Agent, scheduleId: string, body: Record<string, unknown> = {}) {
  return agent.post('/api/billing/batches').send({
    scheduleId,
    unitPriceCents: 10000,
    addonCents: 3000,
    addonNote: '书本费',
    ...body,
  });
}

describe('schedules API', () => {
  it('creates a schedule and lists it with derived range and lesson count', async () => {
    const { agent } = await login();
    const created = await createSchedule(agent);
    expect(created).toMatchObject({
      name: '七月周期',
      lessonCount: 5,
      minDate: day(-6),
      maxDate: day(4),
      batchId: null,
    });
    expect(created.lessons).toHaveLength(5);
    expect(created.lessons[0]).toMatchObject({ date: day(-6), startTime: '18:00', endTime: '20:00' });

    const list = await agent.get('/api/classes/c1/schedules');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: created.id, name: '七月周期', lessonCount: 5, batchId: null });
  });

  it('allows two lessons on the same day at different times, rejects duplicate (date,startTime)', async () => {
    const { agent } = await login();
    const twoADay = [
      { date: day(1), startTime: '08:00', endTime: '10:00' },
      { date: day(1), startTime: '15:00', endTime: '17:00' },
    ];
    const ok = await agent.post('/api/classes/c1/schedules').send({ name: '同天双节', lessons: twoADay });
    expect(ok.status).toBe(201);
    expect(ok.body.lessonCount).toBe(2);

    const dup = await agent.post('/api/classes/c1/schedules').send({
      name: '重复节次',
      lessons: [twoADay[0], { date: day(1), startTime: '08:00', endTime: '11:00' }],
    });
    expect(dup.status).toBe(400);
  });

  it('validates name, lessons shape, time format and ordering', async () => {
    const { agent } = await login();
    const post = (body: any) => agent.post('/api/classes/c1/schedules').send(body);
    expect((await post({ name: ' ', lessons: LESSONS })).status).toBe(400);
    expect((await post({ name: 'x', lessons: [] })).status).toBe(400);
    expect((await post({ name: 'x' })).status).toBe(400);
    expect(
      (await post({ name: 'x', lessons: [{ date: '2026/07/01', startTime: '08:00', endTime: '10:00' }] })).status,
    ).toBe(400);
    expect((await post({ name: 'x', lessons: [{ date: day(1), startTime: '8:00', endTime: '10:00' }] })).status).toBe(
      400,
    );
    expect((await post({ name: 'x', lessons: [{ date: day(1), startTime: '10:00', endTime: '08:00' }] })).status).toBe(
      400,
    );
  });

  it('serves one schedule with its lessons (编辑器回填)', async () => {
    const { agent } = await login();
    const created = await createSchedule(agent);
    const res = await agent.get(`/api/schedules/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.lessons).toHaveLength(5);
    expect(res.body).toMatchObject({ id: created.id, name: '七月周期' });
    const { agent: out } = await login('waiguo');
    expect((await out.get(`/api/schedules/${created.id}`)).status).toBe(404);
  });

  it('replaces lessons wholesale and renames via PUT', async () => {
    const { agent } = await login();
    const created = await createSchedule(agent);
    const res = await agent.put(`/api/schedules/${created.id}`).send({
      name: '八月周期',
      lessons: [{ date: day(10), startTime: '09:00', endTime: '11:00' }],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: '八月周期', lessonCount: 1, minDate: day(10), maxDate: day(10) });
    const rows = sqlite.prepare(`SELECT COUNT(*) c FROM schedule_lessons WHERE schedule_id=?`).get(created.id) as any;
    expect(rows.c).toBe(1);
  });

  it('deletes a schedule without a batch; refuses with 409 once a batch exists', async () => {
    const { agent } = await login();
    const sched = await createSchedule(agent);
    const batch = await createBatch(agent, sched.id);
    expect(batch.status).toBe(201);

    expect((await agent.delete(`/api/schedules/${sched.id}`)).status).toBe(409);

    await agent.delete(`/api/billing/batches/${batch.body.id}`);
    expect((await agent.delete(`/api/schedules/${sched.id}`)).status).toBe(200);
    expect(sqlite.prepare(`SELECT COUNT(*) c FROM schedule_lessons`).get()).toMatchObject({ c: 0 });
  });

  it('isolates schedules across orgs with 404', async () => {
    const { agent } = await login();
    const sched = await createSchedule(agent);
    const { agent: out } = await login('waiguo');
    expect((await out.get('/api/classes/c1/schedules')).status).toBe(404);
    expect((await out.post('/api/classes/c1/schedules').send({ name: 'x', lessons: LESSONS })).status).toBe(404);
    expect((await out.put(`/api/schedules/${sched.id}`).send({ name: 'y' })).status).toBe(404);
    expect((await out.delete(`/api/schedules/${sched.id}`)).status).toBe(404);
  });
});

describe('billing batches API', () => {
  it('snapshots per-student counts and amounts on batch creation (全口径)', async () => {
    const { agent } = await login();
    seedBillingScene();
    const sched = await createSchedule(agent);
    const res = await createBatch(agent, sched.id);
    expect(res.status).toBe(201);
    const inv = new Map(res.body.invoices.map((r: any) => [r.studentId, r]));
    expect(inv.get('s1')).toMatchObject({
      attendedCount: 3,
      plannedCount: 2,
      billableCount: 5,
      unitPriceCents: 10000,
      computedAmountCents: 53000,
      finalAmountCents: 53000,
      adjusted: 0,
      status: 'pending',
    });
    expect(inv.get('s2')).toMatchObject({
      attendedCount: 1,
      plannedCount: 2,
      billableCount: 3,
      computedAmountCents: 33000,
    });
    expect(inv.get('s3')).toMatchObject({
      attendedCount: 2,
      plannedCount: 2,
      billableCount: 4,
      computedAmountCents: 43000,
    });
    expect(inv.get('s4')).toMatchObject({
      attendedCount: 1,
      plannedCount: 0,
      billableCount: 1,
      computedAmountCents: 13000,
    });
    expect(inv.has('s5')).toBe(false);
    expect(res.body).toMatchObject({
      classId: 'c1',
      scheduleId: sched.id,
      unitPriceCents: 10000,
      addonCents: 3000,
      addonNote: '书本费',
    });
    expect(res.body.snapshotAt).toBeTruthy();
  });

  it('charges no addon when billable is 0 (完全没参与的学生 computed=0)', async () => {
    const { agent } = await login();
    // 周期全在过去且没上任何课 → 所有 active 学生 billable=0
    const sched = await createSchedule(agent, [{ date: day(-3), startTime: '18:00', endTime: '20:00' }]);
    const res = await createBatch(agent, sched.id);
    expect(res.status).toBe(201);
    for (const r of res.body.invoices) {
      expect(r).toMatchObject({ billableCount: 0, computedAmountCents: 0, finalAmountCents: 0 });
    }
  });

  it('enforces the 1:1 schedule↔batch rule with 409, allows re-create after delete', async () => {
    const { agent } = await login();
    const sched = await createSchedule(agent);
    const first = await createBatch(agent, sched.id);
    expect(first.status).toBe(201);
    expect((await createBatch(agent, sched.id)).status).toBe(409);

    expect((await agent.delete(`/api/billing/batches/${first.body.id}`)).status).toBe(200);
    expect(sqlite.prepare(`SELECT COUNT(*) c FROM invoices`).get()).toMatchObject({ c: 0 });
    expect((await createBatch(agent, sched.id)).status).toBe(201);
  });

  it('validates unitPriceCents / addonCents as non-negative integer cents', async () => {
    const { agent } = await login();
    const sched = await createSchedule(agent);
    expect((await createBatch(agent, sched.id, { unitPriceCents: undefined })).status).toBe(400);
    expect((await createBatch(agent, sched.id, { unitPriceCents: 99.5 })).status).toBe(400);
    expect((await createBatch(agent, sched.id, { unitPriceCents: -1 })).status).toBe(400);
    expect((await createBatch(agent, sched.id, { addonCents: -3 })).status).toBe(400);
  });

  it('lists org batches with payment progress for the cashier cards', async () => {
    const { agent } = await login();
    seedBillingScene();
    const sched = await createSchedule(agent);
    const created = await createBatch(agent, sched.id);
    const s1inv = created.body.invoices.find((r: any) => r.studentId === 's1');
    await agent.post(`/api/invoices/${s1inv.id}/confirm`);

    const list = await agent.get('/api/billing/batches');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id: created.body.id,
      className: '三年级A班',
      scheduleName: '七月周期',
      lessonCount: 5,
      invoiceCount: 4,
      paidCount: 1,
      paidAmountCents: 53000,
      pendingAmountCents: 33000 + 43000 + 13000,
      totalAmountCents: 53000 + 33000 + 43000 + 13000,
    });
  });

  it('creates a batch with a lessonCount override: 全勤按覆盖次数计费, planned = 覆盖 − 已上', async () => {
    const { agent } = await login();
    seedBillingScene();
    const sched = await createSchedule(agent);
    // 排班 5 节、已上 3 节（含加课 bC），覆盖为 8 → active 学生 planned = 8 − 3 = 5
    const res = await createBatch(agent, sched.id, { lessonCount: 8 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      lessonCount: 8,
      lessonCountOverride: 8,
      scheduleLessonCount: 5,
      heldSessionCount: 3,
      futureLessonCount: 5,
    });
    const inv = new Map(res.body.invoices.map((r: any) => [r.studentId, r]));
    // s1 全勤 3 节 → billable 恰为覆盖次数 8
    expect(inv.get('s1')).toMatchObject({
      attendedCount: 3,
      plannedCount: 5,
      billableCount: 8,
      computedAmountCents: 10000 * 8 + 3000,
    });
    expect(inv.get('s2')).toMatchObject({ attendedCount: 1, plannedCount: 5, billableCount: 6 });
    // 停课生 planned 仍强制 0
    expect(inv.get('s4')).toMatchObject({ attendedCount: 1, plannedCount: 0, billableCount: 1 });
  });

  it('stores no override when lessonCount equals the schedule count (继续跟随排班)', async () => {
    const { agent } = await login();
    seedBillingScene();
    const sched = await createSchedule(agent);
    const res = await createBatch(agent, sched.id, { lessonCount: 5 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ lessonCount: 5, lessonCountOverride: null, scheduleLessonCount: 5 });
    expect(sqlite.prepare(`SELECT lesson_count_override v FROM billing_batches WHERE id=?`).get(res.body.id)).toEqual({
      v: null,
    });
    const s1 = res.body.invoices.find((r: any) => r.studentId === 's1');
    expect(s1).toMatchObject({ attendedCount: 3, plannedCount: 2, billableCount: 5 });
  });

  it('validates lessonCount as a positive integer when provided', async () => {
    const { agent } = await login();
    const sched = await createSchedule(agent);
    expect((await createBatch(agent, sched.id, { lessonCount: 0 })).status).toBe(400);
    expect((await createBatch(agent, sched.id, { lessonCount: -2 })).status).toBe(400);
    expect((await createBatch(agent, sched.id, { lessonCount: 3.5 })).status).toBe(400);
    expect((await createBatch(agent, sched.id, { lessonCount: 'x' })).status).toBe(400);
  });

  it('isolates billing across orgs with 404', async () => {
    const { agent } = await login();
    const sched = await createSchedule(agent);
    const batch = await createBatch(agent, sched.id);
    const invId = batch.body.invoices[0].id;

    const { agent: out } = await login('waiguo');
    expect((await out.post('/api/billing/batches').send({ scheduleId: sched.id, unitPriceCents: 1 })).status).toBe(404);
    expect((await out.get(`/api/billing/batches/${batch.body.id}`)).status).toBe(404);
    expect((await out.post(`/api/billing/batches/${batch.body.id}/recalculate`)).status).toBe(404);
    expect((await out.delete(`/api/billing/batches/${batch.body.id}`)).status).toBe(404);
    expect((await out.put(`/api/invoices/${invId}`).send({ finalAmountCents: 1 })).status).toBe(404);
    expect((await out.post(`/api/invoices/${invId}/confirm`)).status).toBe(404);
    expect((await out.get(`/api/invoices/${invId}/lessons`)).status).toBe(404);
    // org-2 sees an empty cashier list
    expect((await out.get('/api/billing/batches')).body).toEqual([]);
  });
});

describe('invoices API', () => {
  async function scene() {
    const { agent } = await login();
    seedBillingScene();
    const sched = await createSchedule(agent);
    const batch = (await createBatch(agent, sched.id)).body;
    const invOf = (sid: string) => batch.invoices.find((r: any) => r.studentId === sid);
    return { agent, sched, batch, invOf };
  }

  it('confirms and unconfirms payment, stamping who and when', async () => {
    const { agent, invOf } = await scene();
    const res = await agent.post(`/api/invoices/${invOf('s1').id}/confirm`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'paid', paidByName: '王莉' });
    expect(res.body.paidAt).toBeTruthy();

    expect((await agent.post(`/api/invoices/${invOf('s1').id}/confirm`)).status).toBe(409);

    const undo = await agent.post(`/api/invoices/${invOf('s1').id}/unconfirm`);
    expect(undo.status).toBe(200);
    expect(undo.body).toMatchObject({ status: 'pending', paidAt: null, paidByName: null });
    expect((await agent.post(`/api/invoices/${invOf('s1').id}/unconfirm`)).status).toBe(409);
  });

  it('edits unit price / final amount / note on a pending invoice; adjusted follows final≠computed', async () => {
    const { agent, invOf } = await scene();
    // s3: billable 4。改单价 → computed 跟着变，final 未覆盖 → 自动跟随，adjusted=0
    const priced = await agent.put(`/api/invoices/${invOf('s3').id}`).send({ unitPriceCents: 9000 });
    expect(priced.status).toBe(200);
    expect(priced.body).toMatchObject({
      unitPriceCents: 9000,
      computedAmountCents: 9000 * 4 + 3000,
      finalAmountCents: 9000 * 4 + 3000,
      adjusted: 0,
    });

    // s2: 覆盖最终金额 + 备注 → adjusted=1
    const overridden = await agent
      .put(`/api/invoices/${invOf('s2').id}`)
      .send({ finalAmountCents: 30000, note: '老学员优惠' });
    expect(overridden.status).toBe(200);
    expect(overridden.body).toMatchObject({ finalAmountCents: 30000, adjusted: 1, note: '老学员优惠' });

    // 把最终金额改回 computed → adjusted 归 0
    const reset = await agent.put(`/api/invoices/${invOf('s2').id}`).send({ finalAmountCents: 33000 });
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ finalAmountCents: 33000, adjusted: 0 });
  });

  it('refuses to edit a paid invoice (409)', async () => {
    const { agent, invOf } = await scene();
    await agent.post(`/api/invoices/${invOf('s1').id}/confirm`);
    expect((await agent.put(`/api/invoices/${invOf('s1').id}`).send({ finalAmountCents: 1 })).status).toBe(409);
  });

  it('recalculates: pending refreshed (own unit price), adjusted keeps final/note, paid untouched, new student added, billable→0 kept', async () => {
    const { agent, batch, invOf } = await scene();
    // 现场变化：s1 确认收款；s2 覆盖最终金额；s3 改过单价；
    await agent.post(`/api/invoices/${invOf('s1').id}/confirm`);
    await agent.put(`/api/invoices/${invOf('s2').id}`).send({ finalAmountCents: 30000, note: '优惠' });
    await agent.put(`/api/invoices/${invOf('s3').id}`).send({ unitPriceCents: 9000 });
    // 新学生入班；补一节 D@D-2（原「临时取消」那天开了课）；s4 到堂记录被更正为缺席
    const s6 = (await agent.post('/api/classes/c1/students').send({ name: '新生' })).body.id;
    insertSession('bD', day(-2), {
      s1: { attendance: 'present' },
      s2: { attendance: 'present' },
      s3: { attendance: 'present' },
      [s6]: { attendance: 'present' },
    });
    sqlite.prepare(`UPDATE session_memberships SET attendance='absent', made_up=0 WHERE id='bm-bA-s4'`).run();

    const res = await agent.post(`/api/billing/batches/${batch.id}/recalculate`);
    expect(res.status).toBe(200);
    const inv = new Map(res.body.invoices.map((r: any) => [r.studentId, r]));

    // paid 一律不动（计数还是旧快照）
    expect(inv.get('s1')).toMatchObject({
      status: 'paid',
      attendedCount: 3,
      billableCount: 5,
      finalAmountCents: 53000,
    });
    // adjusted：三个 count + computed 刷新，final/note 保留
    expect(inv.get('s2')).toMatchObject({
      attendedCount: 2,
      billableCount: 4,
      computedAmountCents: 43000,
      finalAmountCents: 30000,
      note: '优惠',
      adjusted: 1,
    });
    // 单价被覆盖过 → 按覆盖值重算，final 跟随 computed
    expect(inv.get('s3')).toMatchObject({
      attendedCount: 3,
      billableCount: 5,
      computedAmountCents: 9000 * 5 + 3000,
      finalAmountCents: 9000 * 5 + 3000,
      adjusted: 0,
    });
    // 停课生 s4 出勤被更正没了 → billable 0，行保留、computed 归 0
    expect(inv.get('s4')).toMatchObject({ billableCount: 0, computedAmountCents: 0, finalAmountCents: 0 });
    // 新学生补建：到堂 1 + 未来 2
    expect(inv.get(s6)).toMatchObject({
      attendedCount: 1,
      plannedCount: 2,
      billableCount: 3,
      unitPriceCents: 10000,
      computedAmountCents: 33000,
    });
  });

  it('resets with new terms: batch fields updated, pending unified to new unit price, adjusted keeps final/note, paid untouched', async () => {
    const { agent, batch, invOf } = await scene();
    // 现场：s1 已收款；s2 覆盖最终金额；s3 单独改过单价（重置后应被统一）
    await agent.post(`/api/invoices/${invOf('s1').id}/confirm`);
    await agent.put(`/api/invoices/${invOf('s2').id}`).send({ finalAmountCents: 30000, note: '优惠' });
    await agent.put(`/api/invoices/${invOf('s3').id}`).send({ unitPriceCents: 9000 });

    const res = await agent
      .post(`/api/billing/batches/${batch.id}/recalculate`)
      .send({ unitPriceCents: 8000, addonCents: 1000, addonNote: '新教材费', lessonCount: 6 });
    expect(res.status).toBe(200);
    // 批次条款整体更新；已上 3 节 → futureLessonCount = 6 − 3
    expect(res.body).toMatchObject({
      unitPriceCents: 8000,
      addonCents: 1000,
      addonNote: '新教材费',
      lessonCount: 6,
      lessonCountOverride: 6,
      futureLessonCount: 3,
    });
    const inv = new Map(res.body.invoices.map((r: any) => [r.studentId, r]));

    // paid 一律不动（旧单价、旧金额）
    expect(inv.get('s1')).toMatchObject({ status: 'paid', unitPriceCents: 10000, finalAmountCents: 53000 });
    // s3 之前的单价覆盖被统一为新单价；attended 2 + planned (6−3) → billable 5
    expect(inv.get('s3')).toMatchObject({
      unitPriceCents: 8000,
      attendedCount: 2,
      plannedCount: 3,
      billableCount: 5,
      computedAmountCents: 8000 * 5 + 1000,
      finalAmountCents: 8000 * 5 + 1000,
      adjusted: 0,
    });
    // adjusted：counts/computed 按新条款刷新，final/note 保留
    expect(inv.get('s2')).toMatchObject({
      unitPriceCents: 8000,
      attendedCount: 1,
      plannedCount: 3,
      billableCount: 4,
      computedAmountCents: 8000 * 4 + 1000,
      finalAmountCents: 30000,
      note: '优惠',
      adjusted: 1,
    });
    // 停课生：仍只结已上、按新单价
    expect(inv.get('s4')).toMatchObject({
      unitPriceCents: 8000,
      billableCount: 1,
      computedAmountCents: 8000 * 1 + 1000,
    });
  });

  it('reset validates its optional fields like creation', async () => {
    const { agent, batch } = await scene();
    const post = (body: any) => agent.post(`/api/billing/batches/${batch.id}/recalculate`).send(body);
    expect((await post({ unitPriceCents: -1 })).status).toBe(400);
    expect((await post({ unitPriceCents: 99.5 })).status).toBe(400);
    expect((await post({ addonCents: -3 })).status).toBe(400);
    expect((await post({ lessonCount: 0 })).status).toBe(400);
    expect((await post({ lessonCount: 2.5 })).status).toBe(400);
  });

  it('reset with lessonCount equal to the schedule count clears the override', async () => {
    const { agent, batch } = await scene();
    const withOverride = await agent.post(`/api/billing/batches/${batch.id}/recalculate`).send({ lessonCount: 8 });
    expect(withOverride.status).toBe(200);
    expect(withOverride.body).toMatchObject({ lessonCount: 8, lessonCountOverride: 8 });

    const cleared = await agent.post(`/api/billing/batches/${batch.id}/recalculate`).send({ lessonCount: 5 });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ lessonCount: 5, lessonCountOverride: null });
    // 没带 unitPriceCents 的重算不改任何单价
    for (const r of cleared.body.invoices) expect(r.unitPriceCents).toBe(10000);
  });

  it('serves the per-lesson breakdown for the edit modal', async () => {
    const { agent, invOf } = await scene();
    const res = await agent.get(`/api/invoices/${invOf('s2').id}/lessons`);
    expect(res.status).toBe(200);
    const rows = res.body.rows as any[];
    // 已上 3 节（含排班外加课 bC）+ 过去未开课的排班日 1（D-2）+ 未来按计划 2
    const sessions = rows.filter((r) => r.kind === 'session');
    const planned = rows.filter((r) => r.kind === 'planned');
    const missed = rows.filter((r) => r.kind === 'missed');
    expect(sessions).toHaveLength(3);
    expect(planned).toHaveLength(2);
    expect(missed).toHaveLength(1);
    // s2：A 缺席已补 → 计费；B 请假未补 → 不计费；C 缺席 → 不计费
    const byId = new Map(sessions.map((r) => [r.sessionId, r]));
    expect(byId.get('bA')).toMatchObject({ attendance: 'absent', madeUp: true, billable: true });
    expect(byId.get('bB')).toMatchObject({ attendance: 'leave', madeUp: false, billable: false });
    expect(byId.get('bC')).toMatchObject({ attendance: 'absent', billable: false, inSchedule: false });
    for (const p of planned) expect(p.billable).toBe(true);
    expect(missed[0]).toMatchObject({ date: day(-2), billable: false });
    // 行按日期升序
    const dates = rows.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });

  it('planned rows are not billable for a suspended student (停课只结已上)', async () => {
    const { agent, invOf } = await scene();
    const res = await agent.get(`/api/invoices/${invOf('s4').id}/lessons`);
    expect(res.status).toBe(200);
    for (const p of res.body.rows.filter((r: any) => r.kind === 'planned')) expect(p.billable).toBe(false);
  });
});
