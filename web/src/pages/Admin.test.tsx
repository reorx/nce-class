// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createQueryClient } from '../queries/client';
import { authKeys, billingKeys, classKeys, scheduleKeys, sessionKeys, studentKeys } from '../queries/keys';
import { renderApp } from '../test-utils/app';
import { installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import * as f from '../test-utils/fixtures';

// 批次 F：管理页（删班 / 添加老师 / 改密）。编号对应 Plan 2。

let server: FakeServer;
let client: QueryClient;

beforeEach(() => {
  server = installFakeFetch();
  client = createQueryClient();
  client.setQueryData(authKeys.me(), f.me({ isAdmin: true }));
});

afterEach(() => {
  cleanup();
  client.clear();
  localStorage.clear();
  server.restore();
});

function serveAdmin() {
  server.on('GET', '/api/admin/classes', [f.adminClass(), f.adminClass({ id: 'c2', name: '测试班' })]);
  server.on('GET', '/api/teachers', [
    f.teacher({ isAdmin: true }),
    f.teacher({ id: 't2', name: '李老师', username: 'li' }),
  ]);
}

describe('admin page', () => {
  it('a non-admin never requests the admin list', async () => {
    client.setQueryData(authKeys.me(), f.me({ isAdmin: false }));
    renderApp(client, '/admin');
    await screen.findByText('无权限');
    expect(server.count('GET', '/api/admin/classes')).toBe(0);
  });

  it('B17 deleting a class: a wrong admin password stays inline; success drops every cached entity of that class', async () => {
    serveAdmin();
    client.setQueryData(classKeys.detail('c2'), f.classDetail({ id: 'c2' }));
    client.setQueryData(sessionKeys.detail('x9'), f.sessionDetail({ id: 'x9', classId: 'c2' }));
    client.setQueryData(studentKeys.profile('s9'), f.profile({ class: { id: 'c2', name: '测试班' } }));
    client.setQueryData(billingKeys.detail('b9'), f.batchDetail({ id: 'b9', classId: 'c2' }));
    client.setQueryData(scheduleKeys.detail('p9'), f.scheduleDetail({ id: 'p9' }));
    client.setQueryData(classKeys.detail('c1'), f.classDetail());
    localStorage.setItem('nce.classroom.c2', '{"draft":true}');
    renderApp(client, '/admin');
    await screen.findByText('测试班');

    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[1]);
    server.on('DELETE', '/api/admin/classes/c2', () => json({ error: '管理员密码错误' }, 403));
    fireEvent.change(screen.getByPlaceholderText('管理员密码'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));
    await screen.findByText('管理员密码错误');
    expect(client.getQueryData(classKeys.detail('c2'))).toBeDefined();

    server.on('DELETE', '/api/admin/classes/c2', { ok: true });
    server.on('GET', '/api/admin/classes', [f.adminClass()]);
    fireEvent.change(screen.getByPlaceholderText('管理员密码'), { target: { value: 'demo1234' } });
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));
    await screen.findByText('已删除「测试班」');
    await waitFor(() => expect(screen.queryByText('测试班')).toBeNull());
    expect(server.last('DELETE', '/api/admin/classes/c2')!.body).toEqual({ adminPassword: 'demo1234' });
    for (const key of [
      classKeys.detail('c2'),
      sessionKeys.detail('x9'),
      studentKeys.profile('s9'),
      billingKeys.detail('b9'),
      scheduleKeys.detail('p9'),
    ]) {
      expect(client.getQueryState(key)).toBeUndefined();
    }
    expect(client.getQueryData(classKeys.detail('c1'))).toBeDefined();
    expect(localStorage.getItem('nce.classroom.c2')).toBeNull();
  });

  it('adding a teacher refreshes the shared teacher list', async () => {
    serveAdmin();
    renderApp(client, '/admin');
    await screen.findByText('李老师');
    server.on('POST', '/api/admin/teachers', f.teacher({ id: 't3', name: '周老师', username: 'zhou' }));
    server.on('GET', '/api/teachers', [
      f.teacher(),
      f.teacher({ id: 't2', name: '李老师' }),
      f.teacher({ id: 't3', name: '周老师' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: '+ 添加老师' }));
    fireEvent.change(screen.getByPlaceholderText('如 李芳'), { target: { value: '周老师' } });
    fireEvent.change(screen.getByPlaceholderText('如 lifang，用于登录，添加后不可修改'), { target: { value: 'zhou' } });
    fireEvent.change(screen.getByPlaceholderText('至少 6 位'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: '添加老师' }));
    await screen.findByText(/已添加「周老师」/);
    await screen.findByText('周老师');
  });

  it('resetting a password changes no cached data and keeps the 403 inline', async () => {
    serveAdmin();
    renderApp(client, '/admin');
    await screen.findByText('李老师');
    const gets = () => server.calls.filter((c) => c.method === 'GET').length;
    const readsBefore = gets();
    fireEvent.click(screen.getAllByRole('button', { name: '修改密码' })[1]);
    server.on('PUT', '/api/admin/teachers/t2/password', () => json({ error: '管理员密码错误' }, 403));
    fireEvent.change(screen.getByPlaceholderText('至少 6 位'), { target: { value: 'newpass1' } });
    fireEvent.change(screen.getByPlaceholderText('管理员密码，用于确认本次操作'), { target: { value: 'bad' } });
    fireEvent.click(screen.getAllByRole('button', { name: '修改密码' }).at(-1)!);
    await screen.findByText('管理员密码错误');

    server.on('PUT', '/api/admin/teachers/t2/password', { ok: true });
    fireEvent.change(screen.getByPlaceholderText('管理员密码，用于确认本次操作'), { target: { value: 'demo1234' } });
    fireEvent.click(screen.getAllByRole('button', { name: '修改密码' }).at(-1)!);
    await screen.findByText(/已修改「李老师」的密码/);
    expect(gets()).toBe(readsBefore);
  });

  it('B19 the teacher list fetched on /teachers is reused by /admin while fresh', async () => {
    serveAdmin();
    renderApp(client, '/teachers');
    await screen.findByText('李老师');
    fireEvent.click(screen.getByRole('link', { name: '管理' }));
    await screen.findByText('测试班');
    expect(server.count('GET', '/api/teachers')).toBe(1);
  });
});
