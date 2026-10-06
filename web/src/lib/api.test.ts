// @vitest-environment jsdom
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createQueryClient, queryClient } from '../queries/client';
import { authKeys, billingKeys, classKeys } from '../queries/keys';
import { useConfirmInvoiceMutation } from '../queries/billing';
import { useUpdateAttendanceMutation } from '../queries/attendance';
import { useCommitSessionMutation, useDeleteSessionMutation } from '../queries/sessions';
import { useUpdateStudentMutation } from '../queries/students';
import { seedUniverse, snapshot } from '../test-utils/cacheUniverse';
import { deferred, installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import * as f from '../test-utils/fixtures';
import { renderWithClient } from '../test-utils/query';
import { api, ApiError, type CommitPayload } from './api';

// 兼容出口：旧调用（尚未迁移的页面）与新 hooks 在 wire 与缓存效果上等价。

let server: FakeServer;

beforeEach(() => {
  server = installFakeFetch();
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  server.restore();
});

const payload = { clientSessionId: 'cs-1' } as CommitPayload;

type OldCall = [name: keyof typeof api, call: () => Promise<unknown>, method: string, url: string, rawBody?: string];

const oldCalls: OldCall[] = [
  ['me', () => api.me(), 'GET', '/api/me'],
  ['login', () => api.login('u', 'p'), 'POST', '/api/auth/login', '{"username":"u","password":"p"}'],
  ['logout', () => api.logout(), 'POST', '/api/auth/logout'],
  ['verifyPassword', () => api.verifyPassword('p'), 'POST', '/api/auth/verify-password', '{"password":"p"}'],
  ['teachers', () => api.teachers(), 'GET', '/api/teachers'],
  ['orgTags', () => api.orgTags(), 'GET', '/api/tags'],
  ['updateTeacher', () => api.updateTeacher('t1', { name: 'N' }), 'PUT', '/api/teachers/t1', '{"name":"N"}'],
  ['adminClasses', () => api.adminClasses(), 'GET', '/api/admin/classes'],
  [
    'adminCreateTeacher',
    () => api.adminCreateTeacher({ name: 'N', username: 'u', password: 'p' }),
    'POST',
    '/api/admin/teachers',
    '{"name":"N","username":"u","password":"p"}',
  ],
  [
    'adminDeleteClass',
    () => api.adminDeleteClass('c1', 'a'),
    'DELETE',
    '/api/admin/classes/c1',
    '{"adminPassword":"a"}',
  ],
  [
    'adminResetPassword',
    () => api.adminResetPassword('t2', 'n', 'a'),
    'PUT',
    '/api/admin/teachers/t2/password',
    '{"password":"n","adminPassword":"a"}',
  ],
  ['classes', () => api.classes(), 'GET', '/api/classes'],
  ['classDetail', () => api.classDetail('c1'), 'GET', '/api/classes/c1'],
  [
    'createClass',
    () => api.createClass({ name: 'A', teacherId: 't1', textbook: null }),
    'POST',
    '/api/classes',
    '{"name":"A","teacherId":"t1","textbook":null}',
  ],
  [
    'updateClassInfo',
    () => api.updateClassInfo('c1', { name: 'A', teacherId: 't1', textbook: '2' }),
    'PUT',
    '/api/classes/c1',
    '{"name":"A","teacherId":"t1","textbook":"2"}',
  ],
  ['addStudent', () => api.addStudent('c1', { name: 'T' }), 'POST', '/api/classes/c1/students', '{"name":"T"}'],
  ['updateStudent', () => api.updateStudent('s1', { name: 'T' }), 'PUT', '/api/students/s1', '{"name":"T"}'],
  ['deleteStudent', () => api.deleteStudent('s1'), 'DELETE', '/api/students/s1'],
  [
    'setStudentStatus',
    () => api.setStudentStatus('s1', 'archived'),
    'PUT',
    '/api/students/s1/status',
    '{"status":"archived"}',
  ],
  ['listSessions', () => api.listSessions(), 'GET', '/api/sessions'],
  ['deleteSession', () => api.deleteSession('x1'), 'DELETE', '/api/sessions/x1'],
  [
    'updateSessionInfo',
    () => api.updateSessionInfo('x1', { teacherId: null }),
    'PUT',
    '/api/sessions/x1',
    '{"teacherId":null}',
  ],
  ['saveGrouping', () => api.saveGrouping('c1', []), 'PUT', '/api/classes/c1/groups', '{"groups":[]}'],
  ['updateClassNotes', () => api.updateClassNotes('c1', ''), 'PUT', '/api/classes/c1/notes', '{"notes":""}'],
  [
    'updateHomeworkTemplate',
    () => api.updateHomeworkTemplate('c1', 't'),
    'PUT',
    '/api/classes/c1/homework-template',
    '{"template":"t"}',
  ],
  ['sessionDetail', () => api.sessionDetail('x1'), 'GET', '/api/sessions/x1'],
  [
    'saveSessionHomework',
    () => api.saveSessionHomework('x1', { content: 'c', reviewBook: null, reviewLesson: null }),
    'PUT',
    '/api/sessions/x1/homework',
    '{"content":"c","reviewBook":null,"reviewLesson":null}',
  ],
  ['getStudentProfile', () => api.getStudentProfile('s1'), 'GET', '/api/students/s1/profile'],
  ['getJoinRequests', () => api.getJoinRequests('c1'), 'GET', '/api/classes/c1/join-requests'],
  [
    'commitSession',
    () => api.commitSession('c1', payload),
    'POST',
    '/api/classes/c1/sessions',
    '{"clientSessionId":"cs-1"}',
  ],
  [
    'overwriteSession',
    () => api.overwriteSession('x1', payload),
    'PUT',
    '/api/sessions/x1/commit',
    '{"clientSessionId":"cs-1"}',
  ],
  ['classAttendance', () => api.classAttendance('c1'), 'GET', '/api/classes/c1/attendance'],
  [
    'updateAttendance',
    () => api.updateAttendance('x1', 's1', { status: 'absent' }),
    'PUT',
    '/api/sessions/x1/attendance/s1',
    '{"status":"absent"}',
  ],
  ['listSchedules', () => api.listSchedules('c1'), 'GET', '/api/classes/c1/schedules'],
  [
    'createSchedule',
    () => api.createSchedule('c1', { name: 'S', lessons: [] }),
    'POST',
    '/api/classes/c1/schedules',
    '{"name":"S","lessons":[]}',
  ],
  ['scheduleDetail', () => api.scheduleDetail('p1'), 'GET', '/api/schedules/p1'],
  ['updateSchedule', () => api.updateSchedule('p1', { lessons: [] }), 'PUT', '/api/schedules/p1', '{"lessons":[]}'],
  ['deleteSchedule', () => api.deleteSchedule('p1'), 'DELETE', '/api/schedules/p1'],
  ['listBillingBatches', () => api.listBillingBatches(), 'GET', '/api/billing/batches'],
  [
    'createBillingBatch',
    () => api.createBillingBatch({ scheduleId: 'p1', unitPriceCents: 100 }),
    'POST',
    '/api/billing/batches',
    '{"scheduleId":"p1","unitPriceCents":100}',
  ],
  ['billingBatchDetail', () => api.billingBatchDetail('b1'), 'GET', '/api/billing/batches/b1'],
  ['recalculateBillingBatch', () => api.recalculateBillingBatch('b1'), 'POST', '/api/billing/batches/b1/recalculate'],
  ['deleteBillingBatch', () => api.deleteBillingBatch('b1'), 'DELETE', '/api/billing/batches/b1'],
  ['updateInvoice', () => api.updateInvoice('i1', { note: 'n' }), 'PUT', '/api/invoices/i1', '{"note":"n"}'],
  ['confirmInvoice', () => api.confirmInvoice('i1'), 'POST', '/api/invoices/i1/confirm'],
  ['unconfirmInvoice', () => api.unconfirmInvoice('i1'), 'POST', '/api/invoices/i1/unconfirm'],
  ['invoiceLessons', () => api.invoiceLessons('i1'), 'GET', '/api/invoices/i1/lessons'],
];

describe('old api methods keep their wire contract and return values', () => {
  it('covers all 47 old methods', () => {
    expect(oldCalls.map(([name]) => name).sort()).toEqual(Object.keys(api).sort());
    expect(oldCalls).toHaveLength(47);
  });

  // 响应给足各 cache-effect 需要的字段（写操作成功后会跑缓存规则）。
  const response = (url: string) =>
    url.includes('/attendance/')
      ? { sessionId: 'x1', studentId: 's1', status: 'absent', madeUp: false }
      : url.startsWith('/api/billing') || url.startsWith('/api/invoices')
        ? f.batchDetail()
        : url.startsWith('/api/schedules') || url.endsWith('/schedules')
          ? f.scheduleDetail()
          : url.startsWith('/api/sessions/') && !url.endsWith('/commit')
            ? f.sessionDetail()
            : url.startsWith('/api/teachers') || url.startsWith('/api/admin/teachers')
              ? f.teacher()
              : url.startsWith('/api/students/')
                ? f.student()
                : url === '/api/auth/login' || url === '/api/me'
                  ? f.me()
                  : f.classDetail();

  it.each(oldCalls)('%s', async (_name, call, method, url, rawBody) => {
    server.on(method, url, () => json(response(url)));
    await expect(call()).resolves.toEqual(response(url));
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].rawBody).toBe(rawBody);
  });

  it('rethrows ApiError with the status for old callers', async () => {
    server.on('POST', '/api/invoices/i1/confirm', () => json({ error: '已确认过收款' }, 409));
    const err = await api.confirmInvoice('i1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe('已确认过收款');
  });
});

describe('old writes run the same cache rules as the new hooks', () => {
  type Case = {
    name: string;
    route: [string, string, unknown];
    legacy: () => Promise<unknown>;
    hook: () => { mutateAsync: (v: never) => Promise<unknown> };
    variables: unknown;
  };
  const cases: Case[] = [
    {
      name: 'confirmInvoice',
      route: ['POST', '/api/invoices/i1/confirm', f.invoice({ status: 'paid' })],
      legacy: () => api.confirmInvoice('i1'),
      hook: useConfirmInvoiceMutation as Case['hook'],
      variables: { invoiceId: 'i1' },
    },
    {
      name: 'updateStudent',
      route: ['PUT', '/api/students/s1', f.student({ name: 'Tommy' })],
      legacy: () => api.updateStudent('s1', { name: 'Tommy' }),
      hook: useUpdateStudentMutation as Case['hook'],
      variables: { studentId: 's1', input: { name: 'Tommy' } },
    },
    {
      name: 'deleteSession',
      route: ['DELETE', '/api/sessions/x1', { ok: true }],
      legacy: () => api.deleteSession('x1'),
      hook: useDeleteSessionMutation as Case['hook'],
      variables: { sessionId: 'x1' },
    },
    {
      name: 'commitSession',
      route: ['POST', '/api/classes/c1/sessions', { sessionId: 'x3', recap: f.recap(), created: true }],
      legacy: () => api.commitSession('c1', payload),
      hook: useCommitSessionMutation as Case['hook'],
      variables: { classId: 'c1', payload },
    },
    {
      name: 'updateAttendance',
      route: [
        'PUT',
        '/api/sessions/x1/attendance/s1',
        { sessionId: 'x1', studentId: 's1', status: 'leave', madeUp: false },
      ],
      legacy: () => api.updateAttendance('x1', 's1', { status: 'leave' }),
      hook: useUpdateAttendanceMutation as Case['hook'],
      variables: { classId: 'c1', sessionId: 'x1', studentId: 's1', input: { status: 'leave' } },
    },
  ];

  it.each(cases)('$name', async ({ route, legacy, hook, variables }) => {
    server.on(route[0], route[1], () => json(route[2]));

    seedUniverse(queryClient);
    await legacy();
    const viaBridge = snapshot(queryClient);

    const client = createQueryClient();
    seedUniverse(client);
    const { result } = renderWithClient(client, hook);
    await act(() => result.current.mutateAsync(variables as never));
    expect(snapshot(client)).toEqual(viaBridge);
    expect(viaBridge.invalidated.length + viaBridge.removed.length).toBeGreaterThan(0);
    client.clear();
  });
});

describe('session handling through the bridge', () => {
  it('login switches the session: old server data dropped, me written', async () => {
    queryClient.setQueryData(classKeys.lists(), [f.classListItem()]);
    server.on('POST', '/api/auth/login', f.me({ id: 'tB' }));
    await api.login('b', 'pw');
    expect(queryClient.getQueryState(classKeys.lists())).toBeUndefined();
    expect(queryClient.getQueryData(authKeys.me())).toEqual(f.me({ id: 'tB' }));
  });

  it('a write finishing after the session switched does not touch the new session’s cache', async () => {
    queryClient.setQueryData(authKeys.me(), f.me());
    const slow = deferred<Response>();
    server.on('POST', '/api/billing/batches', () => slow.promise);
    server.on('POST', '/api/auth/logout', { ok: true });
    const pending = api.createBillingBatch({ scheduleId: 'p1', unitPriceCents: 100 });
    await api.logout();
    slow.resolve(json(f.batchDetail({ id: 'b2' })));
    await expect(pending).resolves.toMatchObject({ id: 'b2' });
    expect(queryClient.getQueryState(billingKeys.detail('b2'))).toBeUndefined();
  });
});
