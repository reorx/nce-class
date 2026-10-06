// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackgroundErrorToasts } from './components/BackgroundErrorToasts';
import { ToastProvider } from './components/Toast';
import { authStatus } from './queries/auth';
import { useClassesQuery, useClassQuery } from './queries/classes';
import { createQueryClient } from './queries/client';
import { authKeys, classKeys } from './queries/keys';
import { expireSession } from './queries/session';
import { renderApp } from './test-utils/app';
import { deferred, installFakeFetch, json, type FakeServer } from './test-utils/fakeFetch';
import { classDetail, classListItem, me, teacher } from './test-utils/fixtures';

// 批次 A：身份入口（App / Login / TopBar）与后台错误通知。编号对应 Plan 2「先写的行为测试」。

let server: FakeServer;
let client: QueryClient;

beforeEach(() => {
  server = installFakeFetch();
  client = createQueryClient();
  client.setQueryDefaults(authKeys.all, { retryDelay: 0 });
  client.setQueryDefaults(classKeys.all, { retryDelay: 0 });
});

afterEach(() => {
  cleanup();
  client.clear();
  localStorage.clear();
  server.restore();
});

const teacherA = me({ id: 'tA', name: '老师A', username: 'a' });
const teacherB = me({ id: 'tB', name: '老师B', username: 'b' });

async function submitLogin(username: string) {
  fireEvent.change(await screen.findByPlaceholderText('如 wangli'), { target: { value: username } });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
}

async function clickSignOut(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
  fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
}

describe('auth status derivation', () => {
  it('null = signed out, undefined + error = read failure, undefined = still loading', () => {
    expect(authStatus({ data: teacherA, isError: false })).toBe('in');
    expect(authStatus({ data: teacherA, isError: true })).toBe('in');
    expect(authStatus({ data: null, isError: false })).toBe('out');
    expect(authStatus({ data: undefined, isError: true })).toBe('error');
    expect(authStatus({ data: undefined, isError: false })).toBe('loading');
  });
});

describe('B11 identity read failure is not a sign-out', () => {
  it('a network failure on /api/me shows a retryable error instead of the login form', async () => {
    server.on('GET', '/api/me', () => Promise.reject(new TypeError('Failed to fetch')));
    renderApp(client, '/');
    await screen.findByText('无法读取登录状态');
    expect(screen.queryByPlaceholderText('如 wangli')).toBeNull();

    server.on('GET', '/api/me', teacherA);
    server.on('GET', '/api/classes', [classListItem()]);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText('三年级A班');
  });

  it('a 403 on /api/me is also a read failure, not a sign-out', async () => {
    server.on('GET', '/api/me', () => json({ error: 'forbidden' }, 403));
    renderApp(client, '/teachers');
    await screen.findByText('无法读取登录状态');
    expect(screen.queryByPlaceholderText('如 wangli')).toBeNull();
  });

  it('a 401 on /api/me means signed out: the login form', async () => {
    server.on('GET', '/api/me', () => json({ error: 'unauthorized' }, 401));
    renderApp(client, '/');
    await screen.findByPlaceholderText('如 wangli');
  });

  it('an expired session bounces to login, keeps local classrooms, and re-login returns to the same page', async () => {
    client.setQueryData(authKeys.me(), teacherA);
    localStorage.setItem('nce.classroom.c1', '{"draft":true}');
    server.on('GET', '/api/teachers', [teacher({ id: 'tA', name: '老师A' })]);
    renderApp(client, '/teachers');
    await screen.findByRole('heading', { name: '老师' });

    await act(() => expireSession(client));
    await screen.findByPlaceholderText('如 wangli');
    expect(localStorage.getItem('nce.classroom.c1')).toBe('{"draft":true}');

    server.on('POST', '/api/auth/login', teacherA);
    await submitLogin('a');
    await screen.findByRole('heading', { name: '老师' });
  });
});

describe('login form', () => {
  it('a wrong password stays on the form with the server message; the cache is untouched', async () => {
    server.on('GET', '/api/me', () => json({ error: 'unauthorized' }, 401));
    server.on('POST', '/api/auth/login', () => json({ error: '用户名或密码错误' }, 401));
    renderApp(client, '/login');
    await submitLogin('a');
    await screen.findByText('用户名或密码错误');
    expect(client.getQueryData(authKeys.me())).toBeNull();
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy();
  });
});

describe('B10 switching accounts', () => {
  it('A signs out with a slow read in flight, B signs in: A’s late response never shows; local drafts survive', async () => {
    server.on('GET', '/api/me', () => json({ error: 'unauthorized' }, 401));
    localStorage.setItem('nce.classroom.c1', '{"draft":true}');
    const slowA = deferred<Response>();
    server.on('GET', '/api/classes', () => slowA.promise);
    server.on('POST', '/api/auth/login', teacherA);
    renderApp(client, '/');

    await submitLogin('a');
    await screen.findByRole('heading', { name: '班级' });
    await waitFor(() => expect(server.count('GET', '/api/classes')).toBe(1));

    server.on('POST', '/api/auth/logout', { ok: true });
    await clickSignOut('老师A');
    await screen.findByPlaceholderText('如 wangli');

    server.on('POST', '/api/auth/login', teacherB);
    server.on('GET', '/api/classes', [classListItem({ id: 'cB', name: 'B 的班' })]);
    await submitLogin('b');
    await screen.findByText('B 的班');

    slowA.resolve(json([classListItem({ id: 'cA', name: 'A 的班' })]));
    await act(async () => {});
    expect(screen.queryByText('A 的班')).toBeNull();
    expect(screen.getByRole('button', { name: /老师B/ })).toBeTruthy();
    expect(localStorage.getItem('nce.classroom.c1')).toBe('{"draft":true}');
  });

  it('sign-out lands on a plain login page: the next account starts from the home page', async () => {
    client.setQueryData(authKeys.me(), teacherA);
    server.on('GET', '/api/teachers', [teacher()]);
    server.on('POST', '/api/auth/logout', { ok: true });
    renderApp(client, '/teachers');
    await clickSignOut('老师A');
    await screen.findByPlaceholderText('如 wangli');

    server.on('POST', '/api/auth/login', teacherB);
    server.on('GET', '/api/classes', [classListItem()]);
    await submitLogin('b');
    await screen.findByRole('heading', { name: '班级' });
  });

  it('a failed sign-out says so and keeps the session (the server cookie may still be valid)', async () => {
    client.setQueryData(authKeys.me(), teacherA);
    server.on('GET', '/api/teachers', [teacher()]);
    server.on('POST', '/api/auth/logout', () => Promise.reject(new TypeError('Failed to fetch')));
    renderApp(client, '/teachers');
    await clickSignOut('老师A');
    await screen.findByText(/退出失败/);
    expect(screen.queryByPlaceholderText('如 wangli')).toBeNull();
    expect(client.getQueryData(authKeys.me())).toEqual(teacherA);
  });
});

function Probe({ id }: { id: string }) {
  const q = useClassQuery(id);
  return <div>{q.data?.name ?? '…'}</div>;
}

function ListProbe() {
  const q = useClassesQuery();
  return <div>{q.data ? `${q.data.length} 个班` : '…'}</div>;
}

function renderWithToasts(children: React.ReactNode) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BackgroundErrorToasts />
        {children}
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('B20 background refresh errors reach the toast once', () => {
  it('one failed refresh observed by two components toasts once and keeps the content', async () => {
    server.on('GET', '/api/classes/c1', classDetail());
    renderWithToasts(
      <>
        <Probe id="c1" />
        <Probe id="c1" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByText('三年级A班')).toHaveLength(2));

    server.on('GET', '/api/classes/c1', () => json({ error: 'forbidden' }, 403));
    await act(() => client.invalidateQueries({ queryKey: classKeys.detail('c1') }));
    await screen.findByText(/刷新失败/);
    expect(screen.getAllByText(/刷新失败/)).toHaveLength(1);
    expect(screen.getAllByText('三年级A班')).toHaveLength(2);
  });

  it('several queries failing for the same reason (network down) toast once', async () => {
    server.on('GET', '/api/classes/c1', classDetail());
    server.on('GET', '/api/classes', [classListItem()]);
    renderWithToasts(
      <>
        <Probe id="c1" />
        <ListProbe />
      </>,
    );
    await screen.findByText('1 个班');
    await screen.findByText('三年级A班');

    const offline = () => Promise.reject(new TypeError('Failed to fetch'));
    server.on('GET', '/api/classes/c1', offline);
    server.on('GET', '/api/classes', offline);
    await act(() => client.invalidateQueries({ queryKey: classKeys.all }));
    await screen.findByText(/刷新失败/);
    expect(screen.getAllByText(/刷新失败/)).toHaveLength(1);
  });

  it('a cancelled refresh never toasts', async () => {
    server.on('GET', '/api/classes/c1', classDetail());
    renderWithToasts(<Probe id="c1" />);
    await screen.findByText('三年级A班');

    const slow = deferred<Response>();
    server.on('GET', '/api/classes/c1', () => slow.promise);
    act(() => {
      void client.invalidateQueries({ queryKey: classKeys.detail('c1') });
    });
    await waitFor(() => expect(server.count('GET', '/api/classes/c1')).toBe(2));
    await act(() => client.cancelQueries({ queryKey: classKeys.detail('c1') }));
    await act(async () => {});
    expect(screen.queryByText(/刷新失败/)).toBeNull();
    expect(screen.getByText('三年级A班')).toBeTruthy();
  });
});
