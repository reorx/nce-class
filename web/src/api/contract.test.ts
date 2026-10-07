import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import * as admin from './admin';
import * as attendance from './attendance';
import * as auth from './auth';
import * as billing from './billing';
import * as classes from './classes';
import * as invites from './invites';
import * as schedules from './schedules';
import * as sessions from './sessions';
import * as students from './students';
import * as tags from './tags';
import * as teachers from './teachers';
import type { CommitPayload } from './sessions';

// 搬迁不改 wire contract：每个领域函数的 method / URL / body 与原 lib/api（已删除）逐一对齐。
// body 用 rawBody 断言，确保「缺省 key」与「显式 null」不被混同。

const payload: CommitPayload = {
  clientSessionId: 'cs-1',
  lessonNumber: 3,
  lessonTitle: null,
  teacherId: null,
  plannedDurationMin: 120,
  startedAt: '2026-10-06 09:00:00',
  endedAt: '2026-10-06 11:00:00',
  defaultGrouping: { groups: [] },
  sessionGroups: [],
  memberships: [],
  events: [],
  checks: [],
  tags: [],
};

type Case = [name: string, call: () => Promise<unknown>, method: string, url: string, rawBody?: string];

const cases: Case[] = [
  // auth
  ['getMe', () => auth.getMe(), 'GET', '/api/me'],
  ['login', () => auth.login('wangli', 'pw'), 'POST', '/api/auth/login', '{"username":"wangli","password":"pw"}'],
  ['logout', () => auth.logout(), 'POST', '/api/auth/logout'],
  ['verifyPassword', () => auth.verifyPassword('pw'), 'POST', '/api/auth/verify-password', '{"password":"pw"}'],
  // teachers / tags
  ['listTeachers', () => teachers.listTeachers(), 'GET', '/api/teachers'],
  ['updateTeacher', () => teachers.updateTeacher('t1', { name: '王丽' }), 'PUT', '/api/teachers/t1', '{"name":"王丽"}'],
  ['listTags', () => tags.listTags(), 'GET', '/api/tags'],
  // admin
  ['listAdminClasses', () => admin.listAdminClasses(), 'GET', '/api/admin/classes'],
  [
    'createAdminTeacher',
    () => admin.createAdminTeacher({ name: '李', username: 'li', password: 'pw' }),
    'POST',
    '/api/admin/teachers',
    '{"name":"李","username":"li","password":"pw"}',
  ],
  [
    'deleteAdminClass',
    () => admin.deleteAdminClass('c1', 'apw'),
    'DELETE',
    '/api/admin/classes/c1',
    '{"adminPassword":"apw"}',
  ],
  [
    'resetAdminTeacherPassword',
    () => admin.resetAdminTeacherPassword('t2', 'npw', 'apw'),
    'PUT',
    '/api/admin/teachers/t2/password',
    '{"password":"npw","adminPassword":"apw"}',
  ],
  // classes
  ['listClasses', () => classes.listClasses(), 'GET', '/api/classes'],
  ['getClass', () => classes.getClass('c1'), 'GET', '/api/classes/c1'],
  [
    'createClass',
    () => classes.createClass({ name: 'A', teacherId: 't1', textbook: '1' }),
    'POST',
    '/api/classes',
    '{"name":"A","teacherId":"t1","textbook":"1"}',
  ],
  [
    'updateClass (isArchived omitted)',
    () => classes.updateClass('c1', { name: 'A', teacherId: 't1', textbook: null }),
    'PUT',
    '/api/classes/c1',
    '{"name":"A","teacherId":"t1","textbook":null}',
  ],
  [
    'updateClass (isArchived)',
    () => classes.updateClass('c1', { name: 'A', teacherId: 't1', textbook: 'starterA', isArchived: true }),
    'PUT',
    '/api/classes/c1',
    '{"name":"A","teacherId":"t1","textbook":"starterA","isArchived":true}',
  ],
  [
    'saveClassGrouping',
    () => classes.saveClassGrouping('c1', [{ id: null, name: '海豚', emoji: '🐬', orderIndex: 0, memberIds: ['s1'] }]),
    'PUT',
    '/api/classes/c1/groups',
    '{"groups":[{"id":null,"name":"海豚","emoji":"🐬","orderIndex":0,"memberIds":["s1"]}]}',
  ],
  [
    'updateClassNotes',
    () => classes.updateClassNotes('c1', '# 资源'),
    'PUT',
    '/api/classes/c1/notes',
    '{"notes":"# 资源"}',
  ],
  [
    'updateHomeworkTemplate',
    () => classes.updateHomeworkTemplate('c1', '第{lesson_number}课'),
    'PUT',
    '/api/classes/c1/homework-template',
    '{"template":"第{lesson_number}课"}',
  ],
  // students
  [
    'createStudent',
    () => students.createStudent('c1', { name: 'Tom', cnName: '汤姆' }),
    'POST',
    '/api/classes/c1/students',
    '{"name":"Tom","cnName":"汤姆"}',
  ],
  [
    'updateStudent (cnName omitted)',
    () => students.updateStudent('s1', { name: 'Tom' }),
    'PUT',
    '/api/students/s1',
    '{"name":"Tom"}',
  ],
  [
    'updateStudent (cnName cleared)',
    () => students.updateStudent('s1', { name: 'Tom', cnName: '' }),
    'PUT',
    '/api/students/s1',
    '{"name":"Tom","cnName":""}',
  ],
  ['deleteStudent', () => students.deleteStudent('s1'), 'DELETE', '/api/students/s1'],
  [
    'updateStudentStatus',
    () => students.updateStudentStatus('s1', 'suspended'),
    'PUT',
    '/api/students/s1/status',
    '{"status":"suspended"}',
  ],
  ['getStudentProfile', () => students.getStudentProfile('s1'), 'GET', '/api/students/s1/profile'],
  // sessions
  ['listSessions', () => sessions.listSessions(), 'GET', '/api/sessions'],
  ['getSession', () => sessions.getSession('x1'), 'GET', '/api/sessions/x1'],
  ['deleteSession', () => sessions.deleteSession('x1'), 'DELETE', '/api/sessions/x1'],
  [
    'updateSession (partial)',
    () => sessions.updateSession('x1', { lessonTitle: null }),
    'PUT',
    '/api/sessions/x1',
    '{"lessonTitle":null}',
  ],
  [
    'updateSessionHomework',
    () => sessions.updateSessionHomework('x1', { content: 'hw', reviewBook: '2', reviewLesson: 5 }),
    'PUT',
    '/api/sessions/x1/homework',
    '{"content":"hw","reviewBook":"2","reviewLesson":5}',
  ],
  [
    'commitSession',
    () => sessions.commitSession('c1', payload),
    'POST',
    '/api/classes/c1/sessions',
    JSON.stringify(payload),
  ],
  [
    'overwriteSession',
    () => sessions.overwriteSession('x1', payload),
    'PUT',
    '/api/sessions/x1/commit',
    JSON.stringify(payload),
  ],
  // attendance / invites
  ['getClassAttendance', () => attendance.getClassAttendance('c1'), 'GET', '/api/classes/c1/attendance'],
  [
    'updateAttendance',
    () => attendance.updateAttendance('x1', 's1', { status: 'leave', madeUp: true }),
    'PUT',
    '/api/sessions/x1/attendance/s1',
    '{"status":"leave","madeUp":true}',
  ],
  ['listJoinRequests', () => invites.listJoinRequests('c1'), 'GET', '/api/classes/c1/join-requests'],
  // schedules
  ['listSchedules', () => schedules.listSchedules('c1'), 'GET', '/api/classes/c1/schedules'],
  ['getSchedule', () => schedules.getSchedule('p1'), 'GET', '/api/schedules/p1'],
  [
    'createSchedule',
    () =>
      schedules.createSchedule('c1', {
        name: '秋季',
        lessons: [{ date: '2026-10-10', startTime: '09:00', endTime: '11:00' }],
      }),
    'POST',
    '/api/classes/c1/schedules',
    '{"name":"秋季","lessons":[{"date":"2026-10-10","startTime":"09:00","endTime":"11:00"}]}',
  ],
  [
    'updateSchedule',
    () => schedules.updateSchedule('p1', { name: '冬季' }),
    'PUT',
    '/api/schedules/p1',
    '{"name":"冬季"}',
  ],
  ['deleteSchedule', () => schedules.deleteSchedule('p1'), 'DELETE', '/api/schedules/p1'],
  // billing
  ['listBillingBatches', () => billing.listBillingBatches(), 'GET', '/api/billing/batches'],
  ['getBillingBatch', () => billing.getBillingBatch('b1'), 'GET', '/api/billing/batches/b1'],
  [
    'createBillingBatch',
    () => billing.createBillingBatch({ scheduleId: 'p1', unitPriceCents: 15000, addonCents: 0 }),
    'POST',
    '/api/billing/batches',
    '{"scheduleId":"p1","unitPriceCents":15000,"addonCents":0}',
  ],
  [
    'recalculateBillingBatch (no body = refresh pending rows)',
    () => billing.recalculateBillingBatch('b1'),
    'POST',
    '/api/billing/batches/b1/recalculate',
  ],
  [
    'recalculateBillingBatch (reset terms)',
    () => billing.recalculateBillingBatch('b1', { unitPriceCents: 16000, lessonCount: 10 }),
    'POST',
    '/api/billing/batches/b1/recalculate',
    '{"unitPriceCents":16000,"lessonCount":10}',
  ],
  ['deleteBillingBatch', () => billing.deleteBillingBatch('b1'), 'DELETE', '/api/billing/batches/b1'],
  [
    'updateInvoice',
    () => billing.updateInvoice('i1', { finalAmountCents: 120000, note: '' }),
    'PUT',
    '/api/invoices/i1',
    '{"finalAmountCents":120000,"note":""}',
  ],
  ['confirmInvoice', () => billing.confirmInvoice('i1'), 'POST', '/api/invoices/i1/confirm'],
  ['unconfirmInvoice', () => billing.unconfirmInvoice('i1'), 'POST', '/api/invoices/i1/unconfirm'],
  ['getInvoiceLessons', () => billing.getInvoiceLessons('i1'), 'GET', '/api/invoices/i1/lessons'],
];

let server: FakeServer;
beforeEach(() => {
  server = installFakeFetch();
});
afterEach(() => server.restore());

describe('domain API wire contract', () => {
  it.each(cases)('%s', async (_name, call, method, url, rawBody) => {
    const response = { echo: url };
    server.on(method, url, () => json(response));
    await expect(call()).resolves.toEqual(response);
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].rawBody).toBe(rawBody);
    expect(server.calls[0].credentials).toBe('include');
  });

  it('read functions pass the caller signal through to fetch', async () => {
    type Read = (o: { signal: AbortSignal }) => Promise<unknown>;
    const reads: Read[] = [
      (o) => auth.getMe(o),
      (o) => teachers.listTeachers(o),
      (o) => tags.listTags(o),
      (o) => admin.listAdminClasses(o),
      (o) => classes.listClasses(o),
      (o) => classes.getClass('c1', o),
      (o) => students.getStudentProfile('s1', o),
      (o) => sessions.listSessions(o),
      (o) => sessions.getSession('x1', o),
      (o) => attendance.getClassAttendance('c1', o),
      (o) => invites.listJoinRequests('c1', o),
      (o) => schedules.listSchedules('c1', o),
      (o) => schedules.getSchedule('p1', o),
      (o) => billing.listBillingBatches(o),
      (o) => billing.getBillingBatch('b1', o),
      (o) => billing.getInvoiceLessons('i1', o),
    ];
    for (const [, , method, url] of cases.filter(([, , m]) => m === 'GET')) server.on(method, url, {});
    for (const read of reads) {
      const ctrl = new AbortController();
      await read({ signal: ctrl.signal });
      expect(server.calls.at(-1)!.signal).toBe(ctrl.signal);
    }
    expect(new Set(server.calls.map((c) => c.url)).size).toBe(16);
  });

  it('covers every exported API function exactly once', () => {
    const exported = [admin, attendance, auth, billing, classes, invites, schedules, sessions, students, tags, teachers]
      .flatMap((m) => Object.entries(m).filter(([, v]) => typeof v === 'function'))
      .map(([k]) => k)
      .sort();
    const tested = [...new Set(cases.map(([name]) => name.split(' ')[0]))].sort();
    expect(exported).toEqual(tested);
    expect(exported).toHaveLength(47);
  });
});
