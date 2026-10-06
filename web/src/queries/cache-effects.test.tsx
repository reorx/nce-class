// @vitest-environment jsdom
import { act, cleanup, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingBatchDetail, BillingBatchItem } from '../api/billing';
import type { ClassDetail } from '../api/classes';
import type { Me } from '../api/auth';
import type { TeacherItem } from '../api/teachers';
import type { ClassAttendance } from '../api/attendance';
import { seedUniverse, snapshot, type CacheSnapshot } from '../test-utils/cacheUniverse';
import { deferred, installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import * as f from '../test-utils/fixtures';
import { renderWithClient } from '../test-utils/query';
import {
  useCreateAdminTeacherMutation,
  useDeleteAdminClassMutation,
  useResetAdminTeacherPasswordMutation,
} from './admin';
import { useUpdateAttendanceMutation } from './attendance';
import { useVerifyPasswordMutation } from './auth';
import {
  useBillingBatchesQuery,
  useBillingBatchQuery,
  useConfirmInvoiceMutation,
  useCreateBillingBatchMutation,
  useDeleteBillingBatchMutation,
  useRecalculateBillingBatchMutation,
  useUnconfirmInvoiceMutation,
  useUpdateInvoiceMutation,
} from './billing';
import {
  useClassQuery,
  useCreateClassMutation,
  useSaveClassGroupingMutation,
  useUpdateClassMutation,
  useUpdateClassNotesMutation,
  useUpdateHomeworkTemplateMutation,
} from './classes';
import { createQueryClient, setBackgroundErrorHandler } from './client';
import { authKeys, billingKeys, classKeys, scheduleKeys, sessionKeys, teacherKeys } from './keys';
import { useCreateScheduleMutation, useDeleteScheduleMutation, useUpdateScheduleMutation } from './schedules';
import {
  sessionQueryOptions,
  useCommitSessionMutation,
  useDeleteSessionMutation,
  useOverwriteSessionMutation,
  useUpdateSessionHomeworkMutation,
  useUpdateSessionMutation,
} from './sessions';
import {
  useCreateStudentMutation,
  useDeleteStudentMutation,
  useStudentProfileQuery,
  useUpdateStudentMutation,
  useUpdateStudentStatusMutation,
} from './students';
import { useUpdateTeacherMutation } from './teachers';

let server: FakeServer;
let client: QueryClient;

beforeEach(() => {
  server = installFakeFetch();
  client = createQueryClient();
});

afterEach(() => {
  cleanup();
  client.clear();
  server.restore();
});

type MutationHook<V> = () => { mutateAsync: (variables: V) => Promise<unknown> };

async function mutate<V>(useHook: MutationHook<V>, variables: V) {
  const { result, unmount } = renderWithClient(client, useHook);
  await act(() => result.current.mutateAsync(variables));
  unmount();
}

const sorted = (s: CacheSnapshot) => ({
  removed: [...s.removed].sort(),
  invalidated: [...s.invalidated].sort(),
  changed: [...s.changed].sort(),
});

const expectSnapshot = (expected: Partial<CacheSnapshot>) =>
  expect(sorted(snapshot(client))).toEqual(sorted({ removed: [], invalidated: [], changed: [], ...expected }));

// 一节课的增删改波及的同一组读侧（c1 视角）。
const c1SessionFallout = [
  'sessions/list',
  'sessions/x1',
  'sessions/x2',
  'classes/c1',
  'classes/list',
  'profile/s1',
  'attendance/c1',
  'billing/list',
  'billing/b1',
  'invoice-lessons/i1',
  'invoice-lessons/i9',
  'admin/classes',
];

describe('write → cache matrix (c2 is the untouched control)', () => {
  beforeEach(() => seedUniverse(client));

  describe('classes', () => {
    it('create: full detail written; class lists + admin stats invalidated', async () => {
      const created = f.classDetail({ id: 'c3', name: '新班' });
      server.on('POST', '/api/classes', created);
      await mutate(useCreateClassMutation, { name: '新班', teacherId: 't1', textbook: null });
      expect(client.getQueryData(classKeys.detail('c3'))).toEqual(created);
      expectSnapshot({ invalidated: ['classes/list', 'admin/classes'] });
    });

    it('edit info: detail written; class name shown in sessions, profiles, attendance, billing refreshed', async () => {
      server.on('PUT', '/api/classes/c1', f.classDetail({ name: '改名班' }));
      await mutate(useUpdateClassMutation, {
        classId: 'c1',
        input: { name: '改名班', teacherId: 't1', textbook: null },
      });
      expect(client.getQueryData<ClassDetail>(classKeys.detail('c1'))?.name).toBe('改名班');
      expect(server.last('PUT', '/api/classes/c1')!.body).toEqual({ name: '改名班', teacherId: 't1', textbook: null });
      expectSnapshot({
        changed: ['classes/c1'],
        invalidated: [
          'classes/list',
          'admin/classes',
          'sessions/list',
          'sessions/x1',
          'sessions/x2',
          'profile/s1',
          'attendance/c1',
          'billing/list',
          'billing/b1',
        ],
      });
    });

    it('default grouping: detail written; profiles (current group) and class list refreshed', async () => {
      server.on('PUT', '/api/classes/c1/groups', f.classDetail({ groupCount: 1 }));
      await mutate(useSaveClassGroupingMutation, { classId: 'c1', groups: [] });
      expectSnapshot({ changed: ['classes/c1'], invalidated: ['classes/list', 'profile/s1'] });
    });

    it('class notes: only the detail is written', async () => {
      server.on('PUT', '/api/classes/c1/notes', f.classDetail({ notes: '# 资源' }));
      await mutate(useUpdateClassNotesMutation, { classId: 'c1', notes: '# 资源' });
      expect(client.getQueryData<ClassDetail>(classKeys.detail('c1'))?.notes).toBe('# 资源');
      expectSnapshot({ changed: ['classes/c1'] });
    });

    it('homework template: detail written; that class’s session details refreshed', async () => {
      server.on('PUT', '/api/classes/c1/homework-template', f.classDetail({ homeworkTemplate: 'T' }));
      await mutate(useUpdateHomeworkTemplateMutation, { classId: 'c1', template: 'T' });
      expectSnapshot({ changed: ['classes/c1'], invalidated: ['sessions/x1', 'sessions/x2'] });
    });
  });

  describe('students', () => {
    it('create: roster views refreshed; billing snapshots untouched', async () => {
      server.on('POST', '/api/classes/c1/students', { ...f.student({ id: 's2' }), score: 0 });
      await mutate(useCreateStudentMutation, { classId: 'c1', input: { name: 'Ann' } });
      expectSnapshot({ invalidated: ['classes/c1', 'classes/list', 'attendance/c1', 'admin/classes'] });
    });

    const renameFallout = [
      'classes/c1',
      'classes/list',
      'profile/s1',
      'sessions/x1',
      'sessions/x2',
      'attendance/c1',
      'billing/list',
      'billing/b1',
    ];

    it('rename: every view embedding the name is refreshed; the response does not overwrite the class detail', async () => {
      server.on('PUT', '/api/students/s1', f.student({ name: 'Tommy' }));
      await mutate(useUpdateStudentMutation, { studentId: 's1', classId: 'c1', input: { name: 'Tommy' } });
      expect(server.last('PUT', '/api/students/s1')!.rawBody).toBe('{"name":"Tommy"}');
      expectSnapshot({ invalidated: renameFallout });
    });

    it('rename without classId infers the class from cache', async () => {
      server.on('PUT', '/api/students/s1', f.student({ name: 'Tommy' }));
      await mutate(useUpdateStudentMutation, { studentId: 's1', input: { name: 'Tommy', cnName: '' } });
      expect(server.last('PUT', '/api/students/s1')!.rawBody).toBe('{"name":"Tommy","cnName":""}');
      expectSnapshot({ invalidated: renameFallout });
    });

    it('rename of a student unknown to the cache falls back to domain-wide invalidation', async () => {
      server.on('PUT', '/api/students/s77', f.student({ id: 's77' }));
      await mutate(useUpdateStudentMutation, { studentId: 's77', input: { name: 'X' } });
      expectSnapshot({
        invalidated: [
          'classes/c1',
          'classes/c2',
          'classes/list',
          'sessions/x1',
          'sessions/x2',
          'sessions/x9',
          'attendance/c1',
          'attendance/c2',
          'billing/list',
          'billing/b1',
          'billing/b9',
        ],
      });
    });

    it('status change: roster/grouping, profile, attendance, billing detail, admin; no recalculation', async () => {
      server.on('PUT', '/api/students/s1/status', f.student({ status: 'suspended' }));
      await mutate(useUpdateStudentStatusMutation, { studentId: 's1', classId: 'c1', status: 'suspended' });
      expect(server.calls.map((c) => c.url)).toEqual(['/api/students/s1/status']);
      expectSnapshot({
        invalidated: ['classes/c1', 'classes/list', 'profile/s1', 'attendance/c1', 'billing/b1', 'admin/classes'],
      });
    });

    it('delete: profile and the student’s invoice lessons removed; class/session/billing views refreshed', async () => {
      server.on('DELETE', '/api/students/s1', { ok: true });
      await mutate(useDeleteStudentMutation, { studentId: 's1', classId: 'c1' });
      expectSnapshot({
        removed: ['profile/s1', 'invoice-lessons/i1'],
        invalidated: [
          'classes/c1',
          'classes/list',
          'sessions/list',
          'sessions/x1',
          'sessions/x2',
          'attendance/c1',
          'billing/list',
          'billing/b1',
          'admin/classes',
        ],
      });
    });
  });

  describe('sessions', () => {
    const commitResult = { sessionId: 'x3', recap: f.recap(), created: true };

    it('commit: CommitResult is not cached as a detail; the class’s session fallout + tags refreshed', async () => {
      server.on('POST', '/api/classes/c1/sessions', commitResult);
      await mutate(useCommitSessionMutation, { classId: 'c1', payload: {} as never });
      expect(client.getQueryState(sessionKeys.detail('x3'))).toBeUndefined();
      expectSnapshot({ invalidated: [...c1SessionFallout, 'tags'] });
    });

    it('overwrite: same fallout including the overwritten detail, and tags', async () => {
      server.on('PUT', '/api/sessions/x1/commit', { ...commitResult, sessionId: 'x1', created: false });
      await mutate(useOverwriteSessionMutation, { sessionId: 'x1', classId: 'c1', payload: {} as never });
      expect(server.last('PUT', '/api/sessions/x1/commit')!.body).toEqual({});
      expectSnapshot({ invalidated: [...c1SessionFallout, 'tags'] });
    });

    it('delete: detail removed; fallout refreshed (class inferred from the cached detail)', async () => {
      server.on('DELETE', '/api/sessions/x1', { ok: true });
      await mutate(useDeleteSessionMutation, { sessionId: 'x1' });
      expectSnapshot({
        removed: ['sessions/x1'],
        invalidated: c1SessionFallout.filter((n) => n !== 'sessions/x1'),
      });
    });

    it('edit info: full detail written, not re-fetched; fallout refreshed', async () => {
      server.on('PUT', '/api/sessions/x1', f.sessionDetail({ lessonNumber: 8 }));
      await mutate(useUpdateSessionMutation, { sessionId: 'x1', input: { lessonNumber: 8 } });
      expectSnapshot({ changed: ['sessions/x1'], invalidated: c1SessionFallout.filter((n) => n !== 'sessions/x1') });
    });

    it('homework: detail written; list, sibling details (prevHomework) and class detail refreshed', async () => {
      server.on('PUT', '/api/sessions/x1/homework', f.sessionDetail({ homeworkContent: '新作业' }));
      await mutate(useUpdateSessionHomeworkMutation, {
        sessionId: 'x1',
        input: { content: '新作业', reviewBook: null, reviewLesson: null },
      });
      expectSnapshot({ changed: ['sessions/x1'], invalidated: ['sessions/list', 'sessions/x2', 'classes/c1'] });
    });
  });

  it('attendance: the exact cell is written back; related views refreshed; never recalculates billing', async () => {
    server.on('PUT', '/api/sessions/x1/attendance/s1', {
      sessionId: 'x1',
      studentId: 's1',
      status: 'leave',
      madeUp: true,
    });
    await mutate(useUpdateAttendanceMutation, {
      classId: 'c1',
      sessionId: 'x1',
      studentId: 's1',
      input: { status: 'leave', madeUp: true },
    });
    expect(client.getQueryData<ClassAttendance>(['attendance', 'class', 'c1'])?.records).toEqual([
      { sessionId: 'x1', studentId: 's1', status: 'leave', madeUp: true },
    ]);
    expect(server.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['PUT /api/sessions/x1/attendance/s1']);
    expectSnapshot({
      changed: ['attendance/c1'],
      invalidated: ['sessions/x1', 'sessions/list', 'classes/c1', 'profile/s1', 'invoice-lessons/i1', 'billing/b1'],
    });
  });

  describe('schedules', () => {
    const scheduleFallout = [
      'schedules/list/c1',
      'billing/list',
      'billing/b1',
      'invoice-lessons/i1',
      'invoice-lessons/i9',
      'admin/classes',
    ];

    it('create: detail written; the class’s schedules and billing views refreshed', async () => {
      server.on('POST', '/api/classes/c1/schedules', f.scheduleDetail({ id: 'p2' }));
      await mutate(useCreateScheduleMutation, { classId: 'c1', input: { name: '冬季', lessons: [] } });
      expect(client.getQueryData(scheduleKeys.detail('p2'))).toBeDefined();
      expectSnapshot({ invalidated: scheduleFallout });
    });

    it('edit (class inferred from the cached list): detail written; same fallout', async () => {
      server.on('PUT', '/api/schedules/p1', f.scheduleDetail({ name: '秋季改' }));
      await mutate(useUpdateScheduleMutation, { scheduleId: 'p1', input: { name: '秋季改' } });
      expectSnapshot({ changed: ['schedules/p1'], invalidated: scheduleFallout });
    });

    it('delete: detail removed; same fallout', async () => {
      server.on('DELETE', '/api/schedules/p1', { ok: true });
      await mutate(useDeleteScheduleMutation, { scheduleId: 'p1', classId: 'c1' });
      expectSnapshot({ removed: ['schedules/p1'], invalidated: scheduleFallout });
    });
  });

  describe('billing', () => {
    it('create batch: full detail written so opening it needs no cold load; schedule occupancy refreshed', async () => {
      const created = f.batchDetail({ id: 'b2' });
      server.on('POST', '/api/billing/batches', created);
      await mutate(useCreateBillingBatchMutation, { scheduleId: 'p1', unitPriceCents: 15000 });
      expect(client.getQueryData(billingKeys.detail('b2'))).toEqual(created);
      expectSnapshot({ invalidated: ['billing/list', 'schedules/list/c1', 'schedules/p1', 'admin/classes'] });
    });

    it('recalculate: detail written; list, that batch’s invoice lessons, admin stats refreshed', async () => {
      server.on('POST', '/api/billing/batches/b1/recalculate', f.batchDetail({ unitPriceCents: 16000 }));
      await mutate(useRecalculateBillingBatchMutation, { batchId: 'b1' });
      expect(server.last('POST', '/api/billing/batches/b1/recalculate')!.rawBody).toBeUndefined();
      expectSnapshot({
        changed: ['billing/b1'],
        invalidated: ['billing/list', 'invoice-lessons/i1', 'admin/classes'],
      });
    });

    it('delete batch: detail and its invoice lessons removed; schedule released', async () => {
      server.on('DELETE', '/api/billing/batches/b1', { ok: true });
      await mutate(useDeleteBillingBatchMutation, { batchId: 'b1' });
      expectSnapshot({
        removed: ['billing/b1', 'invoice-lessons/i1'],
        invalidated: ['billing/list', 'schedules/list/c1', 'schedules/p1', 'admin/classes'],
      });
    });

    const paid = f.invoice({ status: 'paid', paidAt: '2026-10-06 10:00:00', paidByName: '王丽' });

    it('confirm: the row is replaced in the cached batch, totals are re-read (not guessed)', async () => {
      server.on('POST', '/api/invoices/i1/confirm', paid);
      await mutate(useConfirmInvoiceMutation, { invoiceId: 'i1', batchId: 'b1' });
      const detail = client.getQueryData<BillingBatchDetail>(billingKeys.detail('b1'))!;
      expect(detail.invoices[0].status).toBe('paid');
      expect(detail.paidAmountCents).toBe(0);
      expectSnapshot({ changed: ['billing/b1'], invalidated: ['billing/b1', 'billing/list', 'admin/classes'] });
    });

    it('unconfirm without batchId finds the holder batch in cache', async () => {
      server.on('POST', '/api/invoices/i1/unconfirm', f.invoice({ note: '撤销确认' }));
      await mutate(useUnconfirmInvoiceMutation, { invoiceId: 'i1' });
      expectSnapshot({ changed: ['billing/b1'], invalidated: ['billing/b1', 'billing/list', 'admin/classes'] });
    });

    it('edit amount: same rule', async () => {
      server.on('PUT', '/api/invoices/i1', f.invoice({ finalAmountCents: 12000, adjusted: 1 }));
      await mutate(useUpdateInvoiceMutation, { invoiceId: 'i1', batchId: 'b1', input: { finalAmountCents: 12000 } });
      expect(server.last('PUT', '/api/invoices/i1')!.body).toEqual({ finalAmountCents: 12000 });
      expectSnapshot({ changed: ['billing/b1'], invalidated: ['billing/b1', 'billing/list', 'admin/classes'] });
    });
  });

  describe('teachers and admin', () => {
    it('rename teacher: teachers list and own me patched; every view showing teacher names refreshed', async () => {
      server.on('PUT', '/api/teachers/t1', f.teacher({ name: '王老师' }));
      await mutate(useUpdateTeacherMutation, { teacherId: 't1', input: { name: '王老师' } });
      expect(client.getQueryData<TeacherItem[]>(teacherKeys.lists())?.[0].name).toBe('王老师');
      expect(client.getQueryData<Me>(authKeys.me())?.name).toBe('王老师');
      expectSnapshot({
        changed: ['teachers', 'me'],
        invalidated: [
          'me',
          'teachers',
          'classes/list',
          'classes/c1',
          'classes/c2',
          'sessions/list',
          'sessions/x1',
          'sessions/x2',
          'sessions/x9',
          'billing/b1',
          'billing/b9',
          'admin/classes',
        ],
      });
    });

    it('admin creates a teacher: only the teacher list refreshes', async () => {
      server.on('POST', '/api/admin/teachers', f.teacher({ id: 't3' }));
      await mutate(useCreateAdminTeacherMutation, { name: '新', username: 'new', password: 'pw' });
      expectSnapshot({ invalidated: ['teachers'] });
    });

    it('admin deletes a class: every cache attributable to it (or unattributable) is dropped', async () => {
      server.on('DELETE', '/api/admin/classes/c1', { ok: true });
      await mutate(useDeleteAdminClassMutation, { classId: 'c1', adminPassword: 'apw' });
      expectSnapshot({
        removed: [
          'classes/c1',
          'attendance/c1',
          'schedules/list/c1',
          'invites/c1',
          'sessions/x1',
          'sessions/x2',
          'profile/s1',
          'billing/b1',
          'schedules/p1',
          'schedules/p9',
          'invoice-lessons/i1',
          'invoice-lessons/i9',
        ],
        invalidated: ['classes/list', 'sessions/list', 'billing/list', 'admin/classes'],
      });
    });

    it('password reset and verification fake no data updates', async () => {
      server.on('PUT', '/api/admin/teachers/t2/password', { ok: true });
      server.on('POST', '/api/auth/verify-password', { ok: true });
      await mutate(useResetAdminTeacherPasswordMutation, { teacherId: 't2', password: 'n', adminPassword: 'a' });
      await mutate(useVerifyPasswordMutation, { password: 'p' });
      expectSnapshot({});
    });
  });
});

describe('observable outcomes', () => {
  it('confirming a payment updates both the detail and the list totals the teacher returns to', async () => {
    let paid = false;
    const detailNow = () =>
      f.batchDetail({
        invoices: [f.invoice({ status: paid ? 'paid' : 'pending' })],
        paidCount: paid ? 1 : 0,
        paidAmountCents: paid ? 15000 : 0,
        pendingAmountCents: paid ? 0 : 15000,
      });
    server.on('GET', '/api/billing/batches', () => json([detailNow()]));
    server.on('GET', '/api/billing/batches/b1', () => json(detailNow()));
    server.on('POST', '/api/invoices/i1/confirm', () => {
      paid = true;
      return json(f.invoice({ status: 'paid' }));
    });

    const { result } = renderWithClient(client, () => ({
      list: useBillingBatchesQuery(),
      detail: useBillingBatchQuery('b1'),
      confirm: useConfirmInvoiceMutation(),
    }));
    await waitFor(() => expect(result.current.detail.isSuccess && result.current.list.isSuccess).toBe(true));
    await act(() => result.current.confirm.mutateAsync({ invoiceId: 'i1', batchId: 'b1' }));

    await waitFor(() => expect(result.current.list.data?.[0].paidAmountCents).toBe(15000));
    expect(result.current.detail.data?.invoices[0].status).toBe('paid');
    expect(result.current.detail.data?.pendingAmountCents).toBe(0);
    expect(server.count('POST', '/api/invoices/i1/confirm')).toBe(1);
  });

  it('a write that succeeded stays a success even if the follow-up refresh fails', async () => {
    const notify = vi.fn();
    setBackgroundErrorHandler(client, notify);
    server.on('GET', '/api/billing/batches/b1', f.batchDetail());
    server.on('POST', '/api/invoices/i1/confirm', f.invoice({ status: 'paid' }));
    const { result } = renderWithClient(client, () => ({
      detail: useBillingBatchQuery('b1'),
      confirm: useConfirmInvoiceMutation(),
    }));
    await waitFor(() => expect(result.current.detail.isSuccess).toBe(true));

    server.on('GET', '/api/billing/batches/b1', () => json({ error: 'boom' }, 400));
    await act(() =>
      expect(result.current.confirm.mutateAsync({ invoiceId: 'i1', batchId: 'b1' })).resolves.toBeDefined(),
    );
    await waitFor(() => expect(result.current.detail.isError).toBe(true));
    expect(result.current.detail.data?.invoices[0].status).toBe('paid');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('a renamed student shows up in an open class detail and profile', async () => {
    let name = 'Tom';
    server.on('GET', '/api/classes/c1', () => json(f.classDetail({ students: [f.student({ name })] })));
    server.on('GET', '/api/students/s1/profile', () => json(f.profile({ student: { ...f.profile().student, name } })));
    server.on('PUT', '/api/students/s1', () => {
      name = 'Tommy';
      return json(f.student({ name }));
    });
    const { result } = renderWithClient(client, () => ({
      cls: useClassQuery('c1'),
      profile: useStudentProfileQuery('s1'),
      rename: useUpdateStudentMutation(),
    }));
    await waitFor(() => expect(result.current.cls.isSuccess && result.current.profile.isSuccess).toBe(true));
    await act(() => result.current.rename.mutateAsync({ studentId: 's1', input: { name: 'Tommy' } }));
    await waitFor(() => expect(result.current.cls.data?.students[0].name).toBe('Tommy'));
    await waitFor(() => expect(result.current.profile.data?.student.name).toBe('Tommy'));
  });

  it('an in-flight read of a deleted session cannot resurrect it', async () => {
    const slow = deferred<Response>();
    server.on('GET', '/api/sessions/x1', () => slow.promise);
    server.on('DELETE', '/api/sessions/x1', { ok: true });
    void client.prefetchQuery(sessionQueryOptions('x1'));
    await waitFor(() => expect(server.count('GET', '/api/sessions/x1')).toBe(1));

    await mutate(useDeleteSessionMutation, { sessionId: 'x1', classId: 'c1' });
    slow.resolve(json(f.sessionDetail()));
    await act(async () => {});
    expect(client.getQueryState(sessionKeys.detail('x1'))).toBeUndefined();
  });

  it('a read issued before a write cannot overwrite the written detail when it lands late', async () => {
    const staleRead = deferred<Response>();
    server.on('GET', '/api/classes/c1', () => staleRead.promise);
    server.on('PUT', '/api/classes/c1/notes', f.classDetail({ notes: '新资源' }));
    const { result } = renderWithClient(client, () => {
      const cls = useClassQuery('c1');
      return { notes: cls.data?.notes, save: useUpdateClassNotesMutation() };
    });
    await waitFor(() => expect(server.count('GET', '/api/classes/c1')).toBe(1));

    await act(() => result.current.save.mutateAsync({ classId: 'c1', notes: '新资源' }));
    staleRead.resolve(json(f.classDetail({ notes: '旧资源' })));
    await act(async () => {});
    await waitFor(() => expect(result.current.notes).toBe('新资源'));
    expect(client.getQueryData<ClassDetail>(classKeys.detail('c1'))?.notes).toBe('新资源');
  });

  it('cache upkeep still runs when the component unmounts before the write finishes', async () => {
    client.setQueryData(classKeys.lists(), [f.classListItem()]);
    const slow = deferred<Response>();
    server.on('POST', '/api/classes', () => slow.promise);
    const { result, unmount } = renderWithClient(client, () => useCreateClassMutation());
    let write!: Promise<unknown>;
    act(() => {
      write = result.current.mutateAsync({ name: 'X', teacherId: 't1', textbook: null });
    });
    await waitFor(() => expect(server.count('POST', '/api/classes')).toBe(1));
    unmount();
    slow.resolve(json(f.classDetail({ id: 'c3' })));
    await write;
    expect(client.getQueryData(classKeys.detail('c3'))).toBeDefined();
    expect(client.getQueryState(classKeys.lists())?.isInvalidated).toBe(true);
  });

  it('billing list is never re-derived locally: unrelated list items stay referentially intact', async () => {
    seedUniverse(client);
    const before = client.getQueryData<BillingBatchItem[]>(billingKeys.lists());
    server.on('POST', '/api/invoices/i1/confirm', f.invoice({ status: 'paid' }));
    await mutate(useConfirmInvoiceMutation, { invoiceId: 'i1', batchId: 'b1' });
    expect(client.getQueryData(billingKeys.lists())).toBe(before);
    expect(client.getQueryState(scheduleKeys.detail('p1'))?.isInvalidated).toBe(false);
  });
});
