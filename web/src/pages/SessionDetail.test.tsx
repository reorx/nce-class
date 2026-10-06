// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttendanceRecord, ClassAttendance } from '../api/attendance';
import { createQueryClient } from '../queries/client';
import { attendanceKeys, authKeys, billingKeys, classKeys, sessionKeys, teacherKeys } from '../queries/keys';
import { renderApp } from '../test-utils/app';
import { deferred, installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import * as f from '../test-utils/fixtures';

// 批次 D：上课记录详情（作业 / 课堂信息 / 模板）与考勤表（并发格、撤销）。编号对应 Plan 2。

let server: FakeServer;
let client: QueryClient;

beforeEach(() => {
  server = installFakeFetch();
  client = createQueryClient();
  client.setQueryDefaults(sessionKeys.all, { retryDelay: 0 });
  client.setQueryDefaults(attendanceKeys.all, { retryDelay: 0 });
  client.setQueryData(authKeys.me(), f.me());
});

afterEach(() => {
  cleanup();
  client.clear();
  server.restore();
});

describe('session detail', () => {
  const detail = f.sessionDetail({
    hasHomework: false,
    homeworkContent: '背诵第7课',
    homeworkTemplate: '- L{lesson_number}',
  });

  async function openSession(tab = '') {
    server.on('GET', '/api/sessions/x1', detail);
    renderApp(client, `/classes/c1/sessions/x1${tab}`);
    await screen.findByRole('heading', { name: /Too late/ });
  }

  it('saving homework writes the detail and refreshes sibling sessions (prevHomework) and the class', async () => {
    client.setQueryData(sessionKeys.detail('x2'), f.sessionDetail({ id: 'x2' }));
    client.setQueryData(classKeys.detail('c1'), f.classDetail());
    await openSession('?tab=homework');
    const area = screen.getByDisplayValue('背诵第7课');
    fireEvent.change(area, { target: { value: '背诵第7课，抄写单词' } });

    server.on('PUT', '/api/sessions/x1/homework', {
      ...detail,
      hasHomework: true,
      homeworkContent: '背诵第7课，抄写单词',
    });
    server.on('GET', '/api/classes/c1', f.classDetail());
    fireEvent.click(screen.getByRole('button', { name: '完成布置' }));
    await screen.findByText('本节课作业已布置');
    await screen.findByRole('button', { name: '更新布置' });
    expect(server.count('GET', '/api/sessions/x1')).toBe(1);
    expect(client.getQueryState(sessionKeys.detail('x2'))!.isInvalidated).toBe(true);
    expect(client.getQueryState(classKeys.detail('c1'))!.isInvalidated).toBe(true);
  });

  it('B09 the homework draft and the template dialog draft survive a background refetch', async () => {
    await openSession('?tab=homework');
    const area = screen.getByDisplayValue('背诵第7课') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: '我改的作业' } });
    fireEvent.click(screen.getByRole('button', { name: /模板设置/ }));
    const tpl = screen.getByDisplayValue('- L{lesson_number}') as HTMLTextAreaElement;
    fireEvent.change(tpl, { target: { value: '- 我改的模板' } });

    server.on('GET', '/api/sessions/x1', {
      ...detail,
      homeworkContent: '别处改的',
      homeworkTemplate: '- 别处改的模板',
    });
    await act(() => client.invalidateQueries({ queryKey: sessionKeys.detail('x1') }));
    await waitFor(() => expect(server.count('GET', '/api/sessions/x1')).toBe(2));
    await act(async () => {});
    expect(tpl.value).toBe('- 我改的模板');
    expect(area.value).toBe('我改的作业');
  });

  it('saving the class template from the session re-reads this session (no manual fetch-and-set)', async () => {
    await openSession('?tab=homework');
    fireEvent.click(screen.getByRole('button', { name: /模板设置/ }));
    fireEvent.change(screen.getByDisplayValue('- L{lesson_number}'), {
      target: { value: '- 新模板 L{lesson_number}' },
    });
    server.on(
      'PUT',
      '/api/classes/c1/homework-template',
      f.classDetail({ homeworkTemplate: '- 新模板 L{lesson_number}' }),
    );
    server.on('GET', '/api/sessions/x1', { ...detail, homeworkTemplate: '- 新模板 L{lesson_number}' });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('作业模板已保存');
    expect(server.count('GET', '/api/sessions/x1')).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    expect(screen.getByDisplayValue('- 新模板 L7')).toBeTruthy();
  });

  it('the info tab reads the shared teacher list and saving writes the returned detail', async () => {
    client.setQueryData(teacherKeys.lists(), [f.teacher(), f.teacher({ id: 't2', name: '李老师' })]);
    await openSession('?tab=info');
    expect(screen.getByRole('option', { name: '李老师' })).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('Too late'), { target: { value: 'Too late (2)' } });
    server.on('PUT', '/api/sessions/x1', { ...detail, lessonTitle: 'Too late (2)' });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('课堂信息已保存');
    await screen.findByRole('heading', { name: /Too late \(2\)/ });
    expect(server.count('GET', '/api/teachers')).toBe(0);
    expect(server.count('GET', '/api/sessions/x1')).toBe(1);
  });

  it('a missing session says so', async () => {
    server.on('GET', '/api/sessions/gone', () => json({ error: 'session not found' }, 404));
    renderApp(client, '/classes/c1/sessions/gone');
    await screen.findByText('课堂不存在或已被删除');
  });
});

// 两节课 × 两个学生；Ann 第二节未在班。格子 title = 「MM/DD · 状态」。
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
      { sessionId: 'x1', studentId: 's1', status: 'present', madeUp: false },
      { sessionId: 'x2', studentId: 's1', status: 'present', madeUp: false },
      { sessionId: 'x1', studentId: 's2', status: 'present', madeUp: false },
    ],
  });

const rec = (sessionId: string, studentId: string, status: AttendanceRecord['status']): AttendanceRecord => ({
  sessionId,
  studentId,
  status,
  madeUp: false,
});

describe('attendance grid', () => {
  async function openGrid() {
    server.on('GET', '/api/classes/c1/attendance', table());
    renderApp(client, '/classes/c1/attendance');
    await screen.findByText('Tom');
  }

  /** 第 row 个学生在 10/01 那一格（Tom = 0，Ann = 1）。 */
  const oct1 = (row: number) => screen.getAllByTitle(/^10\/1 · /)[row];

  function setCell(row: number, label: '缺勤' | '请假' | '到勤') {
    fireEvent.click(oct1(row));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${label}$`) }));
    fireEvent.click(screen.getByRole('button', { name: '✕' }));
  }

  const undoBtn = () => screen.getByRole('button', { name: /撤销/ }) as HTMLButtonElement;

  it('B12 two cells in parallel, one fails: only that cell reverts; a pending cell cannot be resubmitted', async () => {
    await openGrid();
    const slowTom = deferred<Response>();
    server.on('PUT', '/api/sessions/x1/attendance/s1', () => slowTom.promise);
    server.on('PUT', '/api/sessions/x1/attendance/s2', () => json({ error: '服务器错误' }, 500));

    setCell(0, '缺勤');
    await waitFor(() => expect(oct1(0).title).toBe('10/1 · 缺勤'));
    setCell(1, '请假');
    await screen.findByText('保存失败，请重试');
    expect(oct1(1).title).toBe('10/1 · 出勤');
    expect(oct1(0).title).toBe('10/1 · 缺勤');

    fireEvent.click(oct1(0));
    const leave = screen.getByRole('button', { name: /请假$/ }) as HTMLButtonElement;
    expect(leave.disabled).toBe(true);
    fireEvent.click(leave);
    fireEvent.click(screen.getByRole('button', { name: '✕' }));
    expect(server.count('PUT', '/api/sessions/x1/attendance/s1')).toBe(1);

    slowTom.resolve(json(rec('x1', 's1', 'absent')));
    await waitFor(() => expect(undoBtn().disabled).toBe(false));
    expect(oct1(0).title).toBe('10/1 · 缺勤');
  });

  it('B13 only confirmed writes are undoable; a failed undo keeps the entry for retry', async () => {
    await openGrid();
    expect(undoBtn().disabled).toBe(true);
    const slow = deferred<Response>();
    server.on('PUT', '/api/sessions/x1/attendance/s1', () => slow.promise);
    setCell(0, '缺勤');
    expect(undoBtn().disabled).toBe(true);
    slow.resolve(json(rec('x1', 's1', 'absent')));
    await waitFor(() => expect(undoBtn().disabled).toBe(false));

    server.on('PUT', '/api/sessions/x1/attendance/s1', () => json({ error: '服务器错误' }, 500));
    fireEvent.click(undoBtn());
    await screen.findByText('撤销失败，请重试');
    expect(oct1(0).title).toBe('10/1 · 缺勤');
    expect(undoBtn().disabled).toBe(false);

    server.on('PUT', '/api/sessions/x1/attendance/s1', rec('x1', 's1', 'present'));
    fireEvent.click(undoBtn());
    await waitFor(() => expect(oct1(0).title).toBe('10/1 · 出勤'));
    expect(server.last('PUT', '/api/sessions/x1/attendance/s1')!.body).toEqual({ status: 'present', madeUp: false });
    await waitFor(() => expect(undoBtn().disabled).toBe(true));
  });

  it('B13 a table refetch does not overwrite a cell that is still saving', async () => {
    await openGrid();
    const slow = deferred<Response>();
    server.on('PUT', '/api/sessions/x1/attendance/s2', () => slow.promise);
    setCell(1, '请假');
    await waitFor(() => expect(oct1(1).title).toBe('10/1 · 请假'));
    await act(() => client.invalidateQueries({ queryKey: attendanceKeys.byClass('c1') }));
    expect(server.count('GET', '/api/classes/c1/attendance')).toBe(2);
    expect(oct1(1).title).toBe('10/1 · 请假');
    slow.resolve(json(rec('x1', 's2', 'leave')));
    await waitFor(() => expect(undoBtn().disabled).toBe(false));
    expect(oct1(1).title).toBe('10/1 · 请假');
  });

  it('B18 correcting attendance refreshes billing displays but never recalculates', async () => {
    client.setQueryData(billingKeys.detail('b1'), f.batchDetail());
    client.setQueryData(billingKeys.invoiceLessons('i1'), f.invoiceLessons());
    const snapshot = client.getQueryData(billingKeys.detail('b1'));
    await openGrid();
    server.on('PUT', '/api/sessions/x1/attendance/s1', rec('x1', 's1', 'leave'));
    setCell(0, '请假');
    await waitFor(() => expect(undoBtn().disabled).toBe(false));
    expect(client.getQueryState(billingKeys.invoiceLessons('i1'))!.isInvalidated).toBe(true);
    expect(client.getQueryState(billingKeys.detail('b1'))!.isInvalidated).toBe(true);
    expect(client.getQueryData(billingKeys.detail('b1'))).toBe(snapshot);
    expect(server.calls.filter((c) => c.url.includes('recalculate'))).toHaveLength(0);
  });

  it('a first-load failure offers a retry', async () => {
    server.on('GET', '/api/classes/c1/attendance', () => json({ error: '服务器错误' }, 500));
    renderApp(client, '/classes/c1/attendance');
    await screen.findByText('考勤加载失败');
    server.on('GET', '/api/classes/c1/attendance', table());
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText('Tom');
  });
});
