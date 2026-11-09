// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { renderApp } from '../test-utils/app';
import { installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import * as f from '../test-utils/fixtures';
import { createQueryClient } from '../queries/client';
import { authKeys } from '../queries/keys';

let server: FakeServer;
let client: QueryClient;
const record = {
  id: 'mk1',
  studentId: 's1',
  studentName: 'Tom',
  studentStatus: 'active' as const,
  date: '2026-11-09',
  durationMinutes: 60,
  note: null,
  createdByName: '王莉',
  createdAt: '2026-11-09 10:00:00',
  sessionIds: ['x1'],
};
const data = () => f.attendance({ records: [{ sessionId: 'x1', studentId: 's1', status: 'absent' }] });

beforeEach(() => {
  server = installFakeFetch();
  client = createQueryClient();
  client.setQueryData(authKeys.me(), f.me());
  server.on('GET', '/api/classes/c1/attendance', data());
});
afterEach(() => {
  cleanup();
  client.clear();
  server.restore();
});

describe('attendance makeup behavior', () => {
  it('opens the persisted makeups view, shows empty state, switches to the grid and back', async () => {
    renderApp(client, '/classes/c1/attendance?view=makeups');
    await screen.findByText('还没有补课记录');
    fireEvent.click(screen.getByRole('button', { name: '出勤表' }));
    await screen.findByTitle(/^10\/1 · 缺勤/);
    fireEvent.click(screen.getByRole('button', { name: '补课记录' }));
    expect(screen.getByText('还没有补课记录')).toBeTruthy();
  });

  it('prefills student and lesson from an absent cell, saves and shows a covered check', async () => {
    server.on('POST', '/api/classes/c1/makeups', record);
    renderApp(client, '/classes/c1/attendance');
    fireEvent.click(await screen.findByTitle(/^10\/1 · 缺勤/));
    fireEvent.click(screen.getByRole('button', { name: '登记补课' }));
    const form = screen.getByRole('form', { name: '补课记录表单' });
    expect((within(form).getByLabelText('学生') as HTMLSelectElement).value).toBe('s1');
    expect((within(form).getByRole('checkbox', { name: /L/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(form).getByRole('button', { name: '60' }));
    fireEvent.click(within(form).getByRole('button', { name: '保存补课记录' }));
    const covered = await screen.findByTitle(/缺勤（已补课/);
    expect(covered.textContent).toBe('✓补');
    expect(server.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      studentId: 's1',
      durationMinutes: 60,
      sessionIds: ['x1'],
    });
  });

  it('confirms before changing covered attendance to present, retains the empty record and supports undo', async () => {
    server.on('GET', '/api/classes/c1/attendance', { ...data(), makeups: [record] });
    server.on('PUT', '/api/sessions/x1/attendance/s1', {
      sessionId: 'x1',
      studentId: 's1',
      status: 'present',
      unlinkedMakeupId: 'mk1',
    });
    renderApp(client, '/classes/c1/attendance');
    fireEvent.click(await screen.findByTitle(/已补课/));
    fireEvent.click(screen.getByRole('button', { name: /到勤/ }));
    await screen.findByText(/改为到勤将解除抵扣，确定吗/);
    expect(server.count('PUT', '/api/sessions/x1/attendance/s1')).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '确认改为到勤' }));
    await waitFor(() => expect(server.count('PUT', '/api/sessions/x1/attendance/s1')).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    fireEvent.click(screen.getByRole('button', { name: '补课记录' }));
    await screen.findByText('未抵扣任何课');
  });

  it('shows field errors, retains the draft on 409, refreshes and drops invalid selections', async () => {
    server.on('POST', '/api/classes/c1/makeups', () => json({ error: '有课程已被其他补课记录抵扣，请重新选择' }, 409));
    renderApp(client, '/classes/c1/attendance');
    fireEvent.click(await screen.findByTitle(/^10\/1 · 缺勤/));
    fireEvent.click(screen.getByRole('button', { name: '登记补课' }));
    const form = screen.getByRole('form', { name: '补课记录表单' });
    fireEvent.click(within(form).getByRole('button', { name: '保存补课记录' }));
    expect(within(form).getByText('请填写 1–600 的正整数')).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: '60' }));
    server.on('GET', '/api/classes/c1/attendance', { ...data(), makeups: [record] });
    fireEvent.click(within(form).getByRole('button', { name: '保存补课记录' }));
    await screen.findByText('有课程已被其他补课记录抵扣，请重新选择');
    await waitFor(() => expect(server.count('GET', '/api/classes/c1/attendance')).toBe(2));
    expect((within(form).getByLabelText('时长（分钟）') as HTMLInputElement).value).toBe('60');
    await screen.findByText('部分课程已不可抵扣，已取消勾选，请重新选择');
  });

  it('saves a record with no covered lessons for a student without absences', async () => {
    server.on('GET', '/api/classes/c1/attendance', f.attendance());
    server.on('POST', '/api/classes/c1/makeups', { ...record, sessionIds: [] });
    renderApp(client, '/classes/c1/attendance?view=makeups');
    fireEvent.click(await screen.findByRole('button', { name: '登记补课' }));
    const form = screen.getByRole('form', { name: '补课记录表单' });
    fireEvent.change(within(form).getByLabelText('学生'), { target: { value: 's1' } });
    expect(within(form).getByText(/可以先登记，之后有缺课时再编辑这条记录勾选/)).toBeTruthy();
    const save = within(form).getByRole('button', { name: '保存补课记录' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(within(form).getByRole('button', { name: '60' }));
    fireEvent.click(save);
    await waitFor(() => expect(server.count('POST', '/api/classes/c1/makeups')).toBe(1));
    expect(server.calls.find((c) => c.method === 'POST')?.body).toMatchObject({ studentId: 's1', sessionIds: [] });
  });

  it('saves an edited record after unchecking every covered lesson', async () => {
    server.on('GET', '/api/classes/c1/attendance', { ...data(), makeups: [record] });
    server.on('PUT', '/api/makeups/mk1', { ...record, sessionIds: [] });
    renderApp(client, '/classes/c1/attendance?view=makeups');
    fireEvent.click(await screen.findByRole('button', { name: /11\/9/ }));
    const form = screen.getByRole('form', { name: '补课记录表单' });
    fireEvent.click(within(form).getByRole('checkbox', { name: /L7/ }));
    fireEvent.click(within(form).getByRole('button', { name: '保存补课记录' }));
    await waitFor(() => expect(server.count('PUT', '/api/makeups/mk1')).toBe(1));
    expect(server.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ sessionIds: [] });
  });

  it('uses the short delete confirmation for a record without covered lessons', async () => {
    server.on('GET', '/api/classes/c1/attendance', { ...data(), makeups: [{ ...record, sessionIds: [] }] });
    renderApp(client, '/classes/c1/attendance?view=makeups');
    fireEvent.click(await screen.findByRole('button', { name: /11\/9/ }));
    fireEvent.click(screen.getByRole('button', { name: '删除这条补课记录' }));
    expect(screen.getByText('确定删除这条补课记录吗？')).toBeTruthy();
  });
});
