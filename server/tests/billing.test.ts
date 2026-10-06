import type DatabaseType from 'better-sqlite3';
import type { Server } from 'node:http';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { localToday } from '../src/util/time.js';
import { setupTestApp } from './helpers.js';

let app: Server;
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

// 计费口径用真实当天（北京时间，localToday）切分，测试里的日期一律相对
// 同一个「今天」推算，保证任何一天、任何机器时区跑都稳定。
const day = (offset: number) => {
  const d = new Date(`${localToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
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
 * - 周期 5 节：D-6 / D-4 / D-2 / D+2 / D+4（D-2 没开课）
 * - 实际课堂：A@D-6、B@D-4、C@D-5（排班外临时加课，计入已上）→ 已上 3、未上 2
 * - 应收一律 = 单价 × 5 + 附加费，出勤只记「已上到堂」供展示：
 *   s1 全勤 3；s2 A 缺席已补、B 请假未补、C 缺席 → 1；s3 中途入班（A 无快照行）→ 2；
 *   s4 停课、A 到堂 → 1
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
  it('归档后拒绝新建周期和收款项，历史可读，取消归档后可继续创建', async () => {
    const { agent } = await login();
    const existing = await createSchedule(agent);
    const billed = await createSchedule(agent, LESSONS, '历史收款周期');
    const batch = await createBatch(agent, billed.id);
    sqlite.prepare('UPDATE classes SET is_archived=1 WHERE id=?').run('c1');
    const schedule = await agent.post('/api/classes/c1/schedules').send({ name: '新周期', lessons: LESSONS });
    expect(schedule.status).toBe(409);
    expect(schedule.body.error).toContain('归档');
    expect((await createBatch(agent, existing.id)).status).toBe(409);
    expect((await agent.get('/api/classes/c1/schedules')).body).toHaveLength(2);
    expect((await agent.get(`/api/billing/batches/${batch.body.id}`)).status).toBe(200);
    expect((await agent.post(`/api/billing/batches/${batch.body.id}/recalculate`).send({})).status).toBe(200);
    const { agent: outsider } = await login('waiguo');
    expect((await outsider.post('/api/classes/c1/schedules').send({ name: '新周期', lessons: LESSONS })).status).toBe(404);
    expect((await createBatch(outsider, existing.id)).status).toBe(404);
    sqlite.prepare('UPDATE classes SET is_archived=0 WHERE id=?').run('c1');
    await createSchedule(agent);
    expect((await createBatch(agent, existing.id)).status).toBe(201);
  });

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
  it('snapshots the same standard amount for every student; attendance is recorded for display only', async () => {
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
    const standard = { plannedCount: 2, billableCount: 5, computedAmountCents: 53000, finalAmountCents: 53000 };
    expect(inv.get('s2')).toMatchObject({ attendedCount: 1, ...standard });
    expect(inv.get('s3')).toMatchObject({ attendedCount: 2, ...standard });
    // 停课生同样按标准应收，个别情况由老师改最终金额
    expect(inv.get('s4')).toMatchObject({ attendedCount: 1, ...standard });
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

  it('charges the standard amount even when no lesson in the period was held', async () => {
    const { agent } = await login();
    const sched = await createSchedule(agent, [{ date: day(-3), startTime: '18:00', endTime: '20:00' }]);
    const res = await createBatch(agent, sched.id);
    expect(res.status).toBe(201);
    for (const r of res.body.invoices) {
      expect(r).toMatchObject({ attendedCount: 0, billableCount: 1, computedAmountCents: 13000, finalAmountCents: 13000 });
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
      pendingAmountCents: 53000 * 3,
      totalAmountCents: 53000 * 4,
    });
  });

  it('creates a batch with a lessonCount override: 人人按覆盖次数计费, planned = 覆盖 − 已上', async () => {
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
    const standard = { plannedCount: 5, billableCount: 8, computedAmountCents: 10000 * 8 + 3000 };
    expect(inv.get('s1')).toMatchObject({ attendedCount: 3, ...standard });
    expect(inv.get('s2')).toMatchObject({ attendedCount: 1, ...standard });
    expect(inv.get('s4')).toMatchObject({ attendedCount: 1, ...standard });
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

  it('edits final amount / note on a pending invoice; adjusted follows final≠computed', async () => {
    const { agent, invOf } = await scene();
    // s2: 直接填最终金额 + 备注 → adjusted=1，应收不变
    const overridden = await agent
      .put(`/api/invoices/${invOf('s2').id}`)
      .send({ finalAmountCents: 30000, note: '中途入班' });
    expect(overridden.status).toBe(200);
    expect(overridden.body).toMatchObject({
      computedAmountCents: 53000,
      finalAmountCents: 30000,
      adjusted: 1,
      note: '中途入班',
    });

    // 只改备注 → 最终金额保持已填的值
    const noted = await agent.put(`/api/invoices/${invOf('s2').id}`).send({ note: '中途入班，少收 4 节' });
    expect(noted.status).toBe(200);
    expect(noted.body).toMatchObject({ finalAmountCents: 30000, adjusted: 1, note: '中途入班，少收 4 节' });

    // 把最终金额改回应收 → adjusted 归 0
    const reset = await agent.put(`/api/invoices/${invOf('s2').id}`).send({ finalAmountCents: 53000 });
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ finalAmountCents: 53000, adjusted: 0 });
  });

  it('ignores a per-student unit price on edit (单价只在收款项层面设置)', async () => {
    const { agent, invOf } = await scene();
    const res = await agent.put(`/api/invoices/${invOf('s3').id}`).send({ unitPriceCents: 9000 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ unitPriceCents: 10000, computedAmountCents: 53000, finalAmountCents: 53000 });
  });

  it('refuses to edit a paid invoice (409)', async () => {
    const { agent, invOf } = await scene();
    await agent.post(`/api/invoices/${invOf('s1').id}/confirm`);
    expect((await agent.put(`/api/invoices/${invOf('s1').id}`).send({ finalAmountCents: 1 })).status).toBe(409);
  });

  it('recalculates: pending refreshed to the batch terms, adjusted keeps final/note, paid untouched, new student added', async () => {
    const { agent, batch, invOf } = await scene();
    // 现场变化：s1 确认收款；s2 覆盖最终金额；s3 是旧版遗留的单独单价
    await agent.post(`/api/invoices/${invOf('s1').id}/confirm`);
    await agent.put(`/api/invoices/${invOf('s2').id}`).send({ finalAmountCents: 30000, note: '优惠' });
    sqlite.prepare(`UPDATE invoices SET unit_price_cents=9000 WHERE id=?`).run(invOf('s3').id);
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
    // adjusted：到堂刷新、应收照标准，final/note 保留
    expect(inv.get('s2')).toMatchObject({
      attendedCount: 2,
      billableCount: 5,
      computedAmountCents: 53000,
      finalAmountCents: 30000,
      note: '优惠',
      adjusted: 1,
    });
    // 遗留的单独单价统一回批次单价
    expect(inv.get('s3')).toMatchObject({
      attendedCount: 3,
      unitPriceCents: 10000,
      computedAmountCents: 53000,
      finalAmountCents: 53000,
      adjusted: 0,
    });
    // 停课生 s4 出勤被更正没了 → 到堂 0，应收不受影响
    expect(inv.get('s4')).toMatchObject({ attendedCount: 0, billableCount: 5, computedAmountCents: 53000 });
    // 新学生补建：同样按标准应收，到堂 1（D-2 那节）
    expect(inv.get(s6)).toMatchObject({
      attendedCount: 1,
      plannedCount: 2,
      billableCount: 5,
      unitPriceCents: 10000,
      computedAmountCents: 53000,
      finalAmountCents: 53000,
    });
  });

  // 生产问题复现：批次在开课后才建，旧口径按到堂扣减（缺课的学生应收偏低）。
  // 重置收款项后，未手动改过的待收款行一律回到标准应收。
  it('brings invoices snapshotted under the attendance-based rule back to the standard amount on reset', async () => {
    const { agent, batch, invOf } = await scene();
    const legacy = sqlite.prepare(
      `UPDATE invoices SET planned_count=2, billable_count=?, computed_amount_cents=?, final_amount_cents=? WHERE id=?`,
    );
    legacy.run(3, 33000, 33000, invOf('s2').id);
    legacy.run(4, 43000, 43000, invOf('s3').id);

    const res = await agent.post(`/api/billing/batches/${batch.id}/recalculate`).send({ lessonCount: 5 });
    expect(res.status).toBe(200);
    for (const r of res.body.invoices) {
      expect(r).toMatchObject({ billableCount: 5, computedAmountCents: 53000, finalAmountCents: 53000, adjusted: 0 });
    }
  });

  it('resets with new terms: batch fields updated, pending unified to new unit price, adjusted keeps final/note, paid untouched', async () => {
    const { agent, batch, invOf } = await scene();
    // 现场：s1 已收款；s2 覆盖最终金额
    await agent.post(`/api/invoices/${invOf('s1').id}/confirm`);
    await agent.put(`/api/invoices/${invOf('s2').id}`).send({ finalAmountCents: 30000, note: '优惠' });

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
    // 待收款行：新单价 × 新课程次数 6 + 新附加费；未上 = 6 − 已上 3
    expect(inv.get('s3')).toMatchObject({
      unitPriceCents: 8000,
      attendedCount: 2,
      plannedCount: 3,
      billableCount: 6,
      computedAmountCents: 8000 * 6 + 1000,
      finalAmountCents: 8000 * 6 + 1000,
      adjusted: 0,
    });
    // adjusted：应收按新条款刷新，final/note 保留
    expect(inv.get('s2')).toMatchObject({
      unitPriceCents: 8000,
      attendedCount: 1,
      billableCount: 6,
      computedAmountCents: 8000 * 6 + 1000,
      finalAmountCents: 30000,
      note: '优惠',
      adjusted: 1,
    });
    expect(inv.get('s4')).toMatchObject({ unitPriceCents: 8000, billableCount: 6, computedAmountCents: 8000 * 6 + 1000 });
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
    // s2：A 缺席已补、B 请假、C 缺席（排班外加课）；逐节只给出勤，不再有计费标记
    const byId = new Map(sessions.map((r) => [r.sessionId, r]));
    expect(byId.get('bA')).toMatchObject({ attendance: 'absent', madeUp: true });
    expect(byId.get('bB')).toMatchObject({ attendance: 'leave', madeUp: false });
    expect(byId.get('bC')).toMatchObject({ attendance: 'absent', inSchedule: false });
    expect(missed[0]).toMatchObject({ date: day(-2) });
    for (const r of rows) expect(r).not.toHaveProperty('billable');
    // 行按日期升序
    const dates = rows.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });

  // 收款单的学生姓名是 live join, 从不落快照: 改名后不用 recalculate, 重拉即新值。
  it('carries 中文名 and follows a rename without recalculating', async () => {
    sqlite.prepare(`UPDATE students SET cn_name='小明' WHERE id='s1'`).run();
    const { agent, batch, invOf } = await scene();
    expect(invOf('s1')).toMatchObject({ studentName: '小明', studentCnName: '小明' });
    expect(invOf('s2').studentCnName).toBeNull();

    await agent.put('/api/students/s1').send({ name: 'Ming', cnName: '小明明' });
    const again = (await agent.get(`/api/billing/batches/${batch.id}`)).body;
    expect(again.invoices.find((r: any) => r.studentId === 's1')).toMatchObject({
      studentName: 'Ming',
      studentCnName: '小明明',
    });
  });
});
