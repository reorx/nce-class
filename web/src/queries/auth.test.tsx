// @vitest-environment jsdom
import { act, cleanup, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classDetail, classListItem, me } from '../test-utils/fixtures';
import { deferred, installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import { renderWithClient } from '../test-utils/query';
import { useLoginMutation, useLogoutMutation, useMeQuery, useVerifyPasswordMutation } from './auth';
import { useClassesQuery, useUpdateClassNotesMutation } from './classes';
import { createQueryClient } from './client';
import { authKeys, classKeys } from './keys';
import { useCreateStudentMutation } from './students';
import { sessionGeneration } from './session';

let server: FakeServer;
let client: QueryClient;

beforeEach(() => {
  server = installFakeFetch();
  client = createQueryClient();
  client.setQueryDefaults(authKeys.all, { retryDelay: 0 });
});

afterEach(() => {
  cleanup();
  client.clear();
  localStorage.clear();
  server.restore();
});

const teacherA = me({ id: 'tA', name: '老师A' });
const teacherB = me({ id: 'tB', name: '老师B' });

/** 以老师 A 登录并缓存好一份班级列表。 */
async function signedInAsA() {
  client.setQueryData(authKeys.me(), teacherA);
  client.setQueryData(classKeys.lists(), [classListItem({ name: 'A 的班' })]);
}

describe('me query: signed out vs read failure', () => {
  it('maps /api/me 401 to null (signed out) without treating it as an error', async () => {
    server.on('GET', '/api/me', () => json({ error: 'unauthorized' }, 401));
    const { result } = renderWithClient(client, () => useMeQuery());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(server.count('GET', '/api/me')).toBe(1);
  });

  it('a network failure is an error after one retry, never "signed out"', async () => {
    server.on('GET', '/api/me', () => Promise.reject(new TypeError('Failed to fetch')));
    const { result } = renderWithClient(client, () => useMeQuery());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(server.count('GET', '/api/me')).toBe(2);
  });

  it('403 is an error, not a sign-out', async () => {
    server.on('GET', '/api/me', () => json({ error: 'forbidden' }, 403));
    const { result } = renderWithClient(client, () => useMeQuery());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
  it('a me refresh that finds the session gone drops the previous account’s server data', async () => {
    await signedInAsA();
    server.on('GET', '/api/me', () => json({ error: 'unauthorized' }, 401));
    const { result } = renderWithClient(client, () => useMeQuery());
    await act(() => client.invalidateQueries({ queryKey: authKeys.me() }));
    await waitFor(() => expect(result.current.data).toBeNull());
    expect(client.getQueryState(classKeys.lists())).toBeUndefined();
  });
});

describe('login / logout', () => {
  it('login isolates the previous session, then writes me from the response', async () => {
    await signedInAsA();
    const before = sessionGeneration(client);
    server.on('POST', '/api/auth/login', teacherB);
    const { result } = renderWithClient(client, () => ({ me: useMeQuery(), login: useLoginMutation() }));

    await act(() => result.current.login.mutateAsync({ username: 'b', password: 'pw' }));
    await waitFor(() => expect(result.current.me.data).toEqual(teacherB));
    expect(client.getQueryState(classKeys.lists())).toBeUndefined();
    expect(sessionGeneration(client)).toBe(before + 1);
    expect(server.count('GET', '/api/me')).toBe(0);
  });

  it('a wrong password (401) stays on the form: no sign-out, cache untouched', async () => {
    await signedInAsA();
    server.on('POST', '/api/auth/login', () => json({ error: '用户名或密码错误' }, 401));
    const { result } = renderWithClient(client, () => useLoginMutation());
    await act(() =>
      expect(result.current.mutateAsync({ username: 'a', password: 'bad' })).rejects.toThrow('用户名或密码错误'),
    );
    expect(client.getQueryData(authKeys.me())).toEqual(teacherA);
    expect(client.getQueryData(classKeys.lists())).toBeDefined();
  });

  it('the password does not linger in mutation state after login settles', async () => {
    server.on('POST', '/api/auth/login', teacherB);
    const { result } = renderWithClient(client, () => useLoginMutation());
    await act(() => result.current.mutateAsync({ username: 'b', password: 'secret-pw' }));
    await waitFor(() => expect(result.current.isIdle).toBe(true));
    expect(result.current.variables).toBeUndefined();
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  });

  it('verify-password (403 on mismatch) keeps the session and clears the password after failing', async () => {
    await signedInAsA();
    server.on('POST', '/api/auth/verify-password', () => json({ error: '密码错误' }, 403));
    const { result } = renderWithClient(client, () => useVerifyPasswordMutation());
    await act(() => expect(result.current.mutateAsync({ password: 'oops' })).rejects.toThrow('密码错误'));
    await waitFor(() => expect(result.current.variables).toBeUndefined());
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
    expect(client.getQueryData(authKeys.me())).toEqual(teacherA);
  });

  it('logout clears server data and marks signed out; local classroom drafts survive', async () => {
    await signedInAsA();
    localStorage.setItem('nce.classroom.c1', '{"draft":true}');
    server.on('POST', '/api/auth/logout', { ok: true });
    const { result } = renderWithClient(client, () => ({ me: useMeQuery(), logout: useLogoutMutation() }));
    await act(() => result.current.logout.mutateAsync());
    await waitFor(() => expect(result.current.me.data).toBeNull());
    expect(client.getQueryState(classKeys.lists())).toBeUndefined();
    expect(localStorage.getItem('nce.classroom.c1')).toBe('{"draft":true}');
  });

  it('a failed logout reports the failure and keeps the session as is', async () => {
    await signedInAsA();
    server.on('POST', '/api/auth/logout', () => Promise.reject(new TypeError('Failed to fetch')));
    const { result } = renderWithClient(client, () => useLogoutMutation());
    await act(() => expect(result.current.mutateAsync()).rejects.toThrow('网络连接失败'));
    expect(client.getQueryData(authKeys.me())).toEqual(teacherA);
    expect(client.getQueryData(classKeys.lists())).toBeDefined();
  });
});

describe('authenticated 401 = session expired', () => {
  it('a business query 401 clears the cache and signs out, keeping local drafts', async () => {
    await signedInAsA();
    client.setQueryData(classKeys.detail('c1'), classDetail());
    localStorage.setItem('nce.classroom.c1', '{"draft":true}');
    server.on('GET', '/api/classes', () => json({ error: 'unauthorized' }, 401));
    const { result } = renderWithClient(client, () => ({ me: useMeQuery(), list: useClassesQuery() }));
    await act(() => client.invalidateQueries({ queryKey: classKeys.lists() }));
    await waitFor(() => expect(result.current.me.data).toBeNull());
    expect(client.getQueryState(classKeys.detail('c1'))).toBeUndefined();
    expect(localStorage.getItem('nce.classroom.c1')).toBe('{"draft":true}');
  });

  it('a write 401 also expires the session', async () => {
    await signedInAsA();
    server.on('POST', '/api/classes/c1/students', () => json({ error: 'unauthorized' }, 401));
    const { result } = renderWithClient(client, () => useCreateStudentMutation());
    await act(() => expect(result.current.mutateAsync({ classId: 'c1', input: { name: 'Tom' } })).rejects.toThrow());
    await waitFor(() => expect(client.getQueryData(authKeys.me())).toBeNull());
  });

  it('403 on a business query does not sign out', async () => {
    await signedInAsA();
    server.on('GET', '/api/classes', () => json({ error: 'forbidden' }, 403));
    const { result } = renderWithClient(client, () => useClassesQuery());
    await act(() => client.invalidateQueries({ queryKey: classKeys.lists() }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(authKeys.me())).toEqual(teacherA);
  });
});

describe('late responses never leak into the next session', () => {
  it('a slow query from session A is aborted and cannot fill B’s cache', async () => {
    client.setQueryData(authKeys.me(), teacherA);
    const slowA = deferred<Response>();
    server.on('GET', '/api/classes', () => slowA.promise);
    const { result } = renderWithClient(client, () => ({ list: useClassesQuery(), login: useLoginMutation() }));
    await waitFor(() => expect(server.count('GET', '/api/classes')).toBe(1));
    const aRequest = server.last('GET', '/api/classes')!;

    // 仍挂着的观察者会以 B 的身份重新请求；服务端此时给的是 B 的数据。
    server.on('GET', '/api/classes', [classListItem({ name: 'B 的班' })]);
    server.on('POST', '/api/auth/login', teacherB);
    await act(() => result.current.login.mutateAsync({ username: 'b', password: 'pw' }));
    expect(aRequest.signal!.aborted).toBe(true);

    slowA.resolve(json([classListItem({ name: 'A 的班' })]));
    await waitFor(() => expect(result.current.list.data?.[0].name).toBe('B 的班'));
    await act(async () => {});
    expect(client.getQueryData<{ name: string }[]>(classKeys.lists())?.[0].name).toBe('B 的班');
  });

  it('a write from session A finishing after B signs in does not write B’s cache', async () => {
    client.setQueryData(authKeys.me(), teacherA);
    const slow = deferred<Response>();
    server.on('PUT', '/api/classes/c1/notes', () => slow.promise);
    server.on('POST', '/api/auth/login', teacherB);
    const { result } = renderWithClient(client, () => ({
      notes: useUpdateClassNotesMutation(),
      login: useLoginMutation(),
    }));

    let write!: Promise<unknown>;
    act(() => {
      write = result.current.notes.mutateAsync({ classId: 'c1', notes: 'A 的资源' });
    });
    await waitFor(() => expect(server.count('PUT', '/api/classes/c1/notes')).toBe(1));
    await act(() => result.current.login.mutateAsync({ username: 'b', password: 'pw' }));

    slow.resolve(json(classDetail({ notes: 'A 的资源' })));
    await act(() => write);
    expect(client.getQueryData(classKeys.detail('c1'))).toBeUndefined();
  });

  it('a 401 from session A’s write arriving after B signs in does not sign B out', async () => {
    client.setQueryData(authKeys.me(), teacherA);
    const slow = deferred<Response>();
    server.on('POST', '/api/classes/c1/students', () => slow.promise);
    server.on('POST', '/api/auth/login', teacherB);
    const { result } = renderWithClient(client, () => ({ add: useCreateStudentMutation(), login: useLoginMutation() }));

    let write!: Promise<unknown>;
    act(() => {
      write = result.current.add.mutateAsync({ classId: 'c1', input: { name: 'Tom' } }).catch(() => undefined);
    });
    await waitFor(() => expect(server.count('POST', '/api/classes/c1/students')).toBe(1));
    await act(() => result.current.login.mutateAsync({ username: 'b', password: 'pw' }));
    slow.resolve(json({ error: 'unauthorized' }, 401));
    await act(() => write);
    await act(async () => {});
    expect(client.getQueryData(authKeys.me())).toEqual(teacherB);
  });
});

it('once signed out, further 401s do not clear the cache again', async () => {
  client.setQueryData(authKeys.me(), null);
  const spy = vi.spyOn(client, 'removeQueries');
  server.on('GET', '/api/classes', () => json({ error: 'unauthorized' }, 401));
  const { result } = renderWithClient(client, () => useClassesQuery());
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(spy).not.toHaveBeenCalled();
});

// Plan 2 新增：断网刷新后 me 读取失败（无数据），课堂仍可离线进行；恢复联网后任一写成功即证明会话有效，
// 在写操作 resolve 前重读 me，提交后跳转的页面不会卡在「无法读取登录状态」。
describe('recovering an unreadable identity', () => {
  it('a successful write while me is unreadable re-reads me before the write resolves', async () => {
    server.on('GET', '/api/me', () => Promise.reject(new TypeError('Failed to fetch')));
    const { result } = renderWithClient(client, () => ({ me: useMeQuery(), add: useCreateStudentMutation() }));
    await waitFor(() => expect(result.current.me.isError).toBe(true));
    expect(result.current.me.data).toBeUndefined();

    server.on('GET', '/api/me', teacherA);
    server.on('POST', '/api/classes/c1/students', { id: 's9', name: 'Tom', cnName: null, source: 'teacher', status: 'active', hasPhoto: false, score: 0 });
    await act(() => result.current.add.mutateAsync({ classId: 'c1', input: { name: 'Tom' } }));
    expect(client.getQueryData(authKeys.me())).toEqual(teacherA);
  });

  it('writes do not re-read me when identity is known', async () => {
    await signedInAsA();
    server.on('POST', '/api/classes/c1/students', { id: 's9', name: 'Tom', cnName: null, source: 'teacher', status: 'active', hasPhoto: false, score: 0 });
    const { result } = renderWithClient(client, () => useCreateStudentMutation());
    await act(() => result.current.mutateAsync({ classId: 'c1', input: { name: 'Tom' } }));
    expect(server.count('GET', '/api/me')).toBe(0);
  });
});

