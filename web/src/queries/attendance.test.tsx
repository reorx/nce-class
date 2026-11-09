// @vitest-environment jsdom
import { act, cleanup, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttendanceRecord, ClassAttendance } from '../api/attendance';
import { recordKey } from '../lib/attendance';
import { deferred, installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import * as f from '../test-utils/fixtures';
import { renderWithClient } from '../test-utils/query';
import {
  AttendanceCellBusyError,
  useClassAttendanceQuery,
  usePendingAttendanceCells,
  useUpdateAttendanceMutation,
} from './attendance';
import { createQueryClient } from './client';
import { attendanceKeys } from './keys';

let server: FakeServer;
let client: QueryClient;

// 两节课 × 一个学生 = 两格；外加另一个学生一格。
const table = (records?: AttendanceRecord[]): ClassAttendance =>
  f.attendance({
    sessions: [
      { id: 'x1', date: '2026-10-01', startedAt: null, lessonNumber: 7, lessonTitle: null },
      { id: 'x2', date: '2026-10-08', startedAt: null, lessonNumber: 8, lessonTitle: null },
    ],
    students: [
      { id: 's1', name: 'Tom', cnName: null, status: 'active' },
      { id: 's2', name: 'Ann', cnName: null, status: 'active' },
    ],
    records: records ?? [
      { sessionId: 'x1', studentId: 's1', status: 'present' },
      { sessionId: 'x2', studentId: 's1', status: 'present' },
      { sessionId: 'x1', studentId: 's2', status: 'present' },
    ],
  });

const cell = (data: ClassAttendance | undefined, sessionId: string, studentId: string) =>
  data?.records.find((r) => r.sessionId === sessionId && r.studentId === studentId);

beforeEach(() => {
  server = installFakeFetch();
  client = createQueryClient();
  server.on('GET', '/api/classes/c1/attendance', table());
});

afterEach(() => {
  cleanup();
  client.clear();
  server.restore();
});

function renderGrid() {
  // data 在渲染时读取：tracked props 下只有渲染中读过的字段变化才会触发重渲染（与真实组件一致）。
  return renderWithClient(client, () => {
    const grid = useClassAttendanceQuery('c1');
    return {
      grid,
      data: grid.data,
      pending: usePendingAttendanceCells('c1'),
      update: useUpdateAttendanceMutation(),
    };
  });
}

const vars = (sessionId: string, studentId: string, status: AttendanceRecord['status']) => ({
  classId: 'c1',
  sessionId,
  studentId,
  input: { status },
});

describe('attendance grid', () => {
  it('shows a pending change immediately, then the confirmed record', async () => {
    const put = deferred<Response>();
    server.on('PUT', '/api/sessions/x1/attendance/s1', () => put.promise);
    const { result } = renderGrid();
    await waitFor(() => expect(result.current.grid.isSuccess).toBe(true));

    let write!: Promise<unknown>;
    act(() => {
      write = result.current.update.mutateAsync(vars('x1', 's1', 'absent'));
    });
    await waitFor(() => expect(cell(result.current.data, 'x1', 's1')?.status).toBe('absent'));
    expect(result.current.pending.has(recordKey('x1', 's1'))).toBe(true);

    put.resolve(json({ sessionId: 'x1', studentId: 's1', status: 'absent' }));
    await act(() => write);
    await waitFor(() => expect(result.current.pending.size).toBe(0));
    expect(cell(result.current.data, 'x1', 's1')).toEqual({
      sessionId: 'x1',
      studentId: 's1',
      status: 'absent',
    });
    expect(server.count('GET', '/api/classes/c1/attendance')).toBe(1);
  });

  it('shows a pending present status', async () => {
    const put = deferred<Response>();
    server.on('PUT', '/api/sessions/x1/attendance/s1', () => put.promise);
    const { result } = renderGrid();
    await waitFor(() => expect(result.current.grid.isSuccess).toBe(true));
    act(() => {
      void result.current.update.mutateAsync(vars('x1', 's1', 'present'));
    });
    await waitFor(() => expect(result.current.pending.size).toBe(1));
    put.resolve(json({ sessionId: 'x1', studentId: 's1', status: 'present' }));
  });

  it('two cells change in parallel; only the failed one reverts', async () => {
    const ok = deferred<Response>();
    const bad = deferred<Response>();
    server.on('PUT', '/api/sessions/x1/attendance/s1', () => ok.promise);
    server.on('PUT', '/api/sessions/x2/attendance/s1', () => bad.promise);
    const { result } = renderGrid();
    await waitFor(() => expect(result.current.grid.isSuccess).toBe(true));

    let a!: Promise<unknown>;
    let b!: Promise<unknown>;
    act(() => {
      a = result.current.update.mutateAsync(vars('x1', 's1', 'leave'));
      b = result.current.update.mutateAsync(vars('x2', 's1', 'absent')).catch((e) => e);
    });
    await waitFor(() => expect(result.current.pending.size).toBe(2));

    bad.resolve(json({ error: 'boom' }, 500));
    await act(() => b);
    await waitFor(() => expect(result.current.pending.size).toBe(1));
    expect(cell(result.current.data, 'x2', 's1')?.status).toBe('present');
    expect(cell(result.current.data, 'x1', 's1')?.status).toBe('leave');

    ok.resolve(json({ sessionId: 'x1', studentId: 's1', status: 'leave' }));
    await act(() => a);
    await waitFor(() => expect(result.current.pending.size).toBe(0));
    expect(cell(result.current.data, 'x1', 's1')?.status).toBe('leave');
    expect(cell(result.current.data, 'x2', 's1')?.status).toBe('present');
  });

  it('refuses a second write to the same cell while the first is pending', async () => {
    const put = deferred<Response>();
    server.on('PUT', '/api/sessions/x1/attendance/s1', () => put.promise);
    const { result } = renderGrid();
    await waitFor(() => expect(result.current.grid.isSuccess).toBe(true));

    let first!: Promise<unknown>;
    act(() => {
      first = result.current.update.mutateAsync(vars('x1', 's1', 'absent'));
    });
    await waitFor(() => expect(result.current.pending.size).toBe(1));
    await act(() =>
      expect(result.current.update.mutateAsync(vars('x1', 's1', 'leave'))).rejects.toBeInstanceOf(
        AttendanceCellBusyError,
      ),
    );
    expect(server.count('PUT', '/api/sessions/x1/attendance/s1')).toBe(1);
    expect(cell(result.current.data, 'x1', 's1')?.status).toBe('absent');

    put.resolve(json({ sessionId: 'x1', studentId: 's1', status: 'absent' }));
    await act(() => first);
    // 释放后同一格可以再改（例如撤销）。
    server.on('PUT', '/api/sessions/x1/attendance/s1', {
      sessionId: 'x1',
      studentId: 's1',
      status: 'present',
    });
    await act(() => result.current.update.mutateAsync(vars('x1', 's1', 'present')));
    expect(server.count('PUT', '/api/sessions/x1/attendance/s1')).toBe(2);
  });

  it('a table refetch during a pending write refreshes other cells but keeps the pending one', async () => {
    const put = deferred<Response>();
    server.on('PUT', '/api/sessions/x1/attendance/s1', () => put.promise);
    const { result } = renderGrid();
    await waitFor(() => expect(result.current.grid.isSuccess).toBe(true));
    act(() => {
      void result.current.update.mutateAsync(vars('x1', 's1', 'absent'));
    });
    await waitFor(() => expect(result.current.pending.size).toBe(1));

    // 另一位老师改了 Ann 的出勤；快照里 Tom 这格仍是旧值。
    server.on(
      'GET',
      '/api/classes/c1/attendance',
      table([
        { sessionId: 'x1', studentId: 's1', status: 'present' },
        { sessionId: 'x2', studentId: 's1', status: 'present' },
        { sessionId: 'x1', studentId: 's2', status: 'leave' },
      ]),
    );
    await act(() => client.refetchQueries({ queryKey: attendanceKeys.byClass('c1') }));
    await waitFor(() => expect(cell(result.current.data, 'x1', 's2')?.status).toBe('leave'));
    expect(cell(result.current.data, 'x1', 's1')?.status).toBe('absent');
    put.resolve(json({ sessionId: 'x1', studentId: 's1', status: 'absent' }));
  });

  it('a snapshot taken before the write lands cannot overwrite the confirmed cell', async () => {
    const put = deferred<Response>();
    const staleGet = deferred<Response>();
    server.on('PUT', '/api/sessions/x1/attendance/s1', () => put.promise);
    const { result } = renderGrid();
    await waitFor(() => expect(result.current.grid.isSuccess).toBe(true));
    let write!: Promise<unknown>;
    act(() => {
      write = result.current.update.mutateAsync(vars('x1', 's1', 'absent'));
    });
    await waitFor(() => expect(result.current.pending.size).toBe(1));

    server.on('GET', '/api/classes/c1/attendance', () => staleGet.promise);
    act(() => {
      void client.refetchQueries({ queryKey: attendanceKeys.byClass('c1') });
    });
    await waitFor(() => expect(server.count('GET', '/api/classes/c1/attendance')).toBe(2));

    // 写入完成时表正在重取 → 重启重取；随后的新快照已包含本次写入。
    server.on('GET', '/api/classes/c1/attendance', () =>
      json(table([{ sessionId: 'x1', studentId: 's1', status: 'absent' }])),
    );
    put.resolve(json({ sessionId: 'x1', studentId: 's1', status: 'absent' }));
    await act(() => write);
    staleGet.resolve(json(table()));
    await act(async () => {});
    await waitFor(() => expect(result.current.pending.size).toBe(0));
    expect(cell(result.current.data, 'x1', 's1')?.status).toBe('absent');
    expect(cell(client.getQueryData(attendanceKeys.byClass('c1')), 'x1', 's1')?.status).toBe('absent');
  });
});
