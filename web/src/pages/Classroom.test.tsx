// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { buildClassroomSession, loadSession, saveSession, type ClassroomSession } from '../lib/classroomStore';
import { configFromDetail } from '../lib/setup';
import { createQueryClient } from '../queries/client';
import { authKeys, classKeys, sessionKeys } from '../queries/keys';
import { renderApp } from '../test-utils/app';
import { deferred, installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import * as f from '../test-utils/fixtures';

// 批次 E：课前配置与课堂。本地优先不变：恢复不等服务器、后台刷新与 StrictMode 不重新初始化、
// 结束课堂冻结 payload + 备份、失败可重试。编号对应 Plan 2。

let server: FakeServer;
let client: QueryClient;

beforeEach(() => {
  server = installFakeFetch();
  client = createQueryClient();
  client.setQueryDefaults(sessionKeys.all, { retryDelay: 0 });
  client.setQueryDefaults(classKeys.all, { retryDelay: 0 });
  client.setQueryData(authKeys.me(), f.me());
});

afterEach(() => {
  cleanup();
  client.clear();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  server.restore();
});

const detail = f.classDetail({
  students: [f.student({ groupId: 'g1' }), f.student({ id: 's2', name: 'Amy', cnName: null, groupId: 'g1' })],
  groups: [{ id: 'g1', name: '海豚组', emoji: '🐬', orderIndex: 0, memberIds: ['s1', 's2'] }],
  studentCount: 2,
  groupCount: 1,
});

/** 存一节进行中的本地课堂（含一条计分事件），返回它。 */
function storeLive(over: Partial<ClassroomSession> = {}): ClassroomSession {
  const base = buildClassroomSession(
    configFromDetail(detail, { lessonNumber: '7', lessonTitle: 'Too late', durationMin: 120, className: detail.name }),
    { classId: 'c1', clientSessionId: 'cs-live', startedAt: '2026-10-07 18:00:00' },
  );
  const s: ClassroomSession = {
    ...base,
    events: [{ id: 1, tt: 'student', tid: 's1', g: 'g1', d: 1, createdAt: '2026-10-07 18:05:00' }],
    nid: 2,
    homeworkContent: '草稿作业',
    ...over,
  };
  saveSession(s);
  return s;
}

const stored = () => localStorage.getItem('nce.classroom.c1');
const offline = () => Promise.reject(new TypeError('Failed to fetch'));

describe('B14 local classroom first', () => {
  it('a stored classroom renders on the first frame with the server offline; refreshes never re-initialise it', async () => {
    const s = storeLive();
    const before = stored();
    server.on('GET', '/api/teachers', offline);
    server.on('GET', '/api/tags', offline);
    renderApp(client, '/classes/c1/classroom');
    expect(screen.getByText('三年级A班')).toBeTruthy();
    expect(screen.getAllByText('Tom').length).toBeGreaterThan(0);
    expect(screen.queryByText('加载课堂…')).toBeNull();

    await act(() => client.invalidateQueries());
    await act(async () => {});
    expect(stored()).toBe(before);
    expect(loadSession('c1')!.clientSessionId).toBe(s.clientSessionId);
    expect(loadSession('c1')!.events).toHaveLength(1);
  });

  it('a page refresh with the server down (identity unreadable) still opens the stored classroom', async () => {
    client.removeQueries({ queryKey: authKeys.me() });
    client.setQueryDefaults(authKeys.all, { retryDelay: 0 });
    storeLive();
    server.on('GET', '/api/me', offline);
    server.on('GET', '/api/teachers', offline);
    server.on('GET', '/api/tags', offline);
    renderApp(client, '/classes/c1/classroom');
    expect(screen.getByText('三年级A班')).toBeTruthy();
    await waitFor(() => expect(server.count('GET', '/api/me')).toBe(2));
    await act(async () => {});
    expect(screen.getByRole('button', { name: /结束课堂/ })).toBeTruthy();
    expect(screen.queryByText('无法读取登录状态')).toBeNull();
    expect(loadSession('c1')!.clientSessionId).toBe('cs-live');
  });

  it('…but without a stored classroom an unreadable identity is still an error, and a confirmed 401 still means login', async () => {
    client.removeQueries({ queryKey: authKeys.me() });
    client.setQueryDefaults(authKeys.all, { retryDelay: 0 });
    server.on('GET', '/api/me', offline);
    renderApp(client, '/classes/c1/classroom');
    await screen.findByText('无法读取登录状态');
    cleanup();

    client.clear();
    storeLive();
    server.on('GET', '/api/me', () => json({ error: 'unauthorized' }, 401));
    renderApp(client, '/classes/c1/classroom');
    await screen.findByPlaceholderText('如 wangli');
    expect(loadSession('c1')).not.toBeNull();
  });

  it('URL lesson params never replace a stored classroom', async () => {
    storeLive();
    renderApp(client, '/classes/c1/classroom?lesson=9&title=New');
    expect(screen.getByText('三年级A班')).toBeTruthy();
    expect(loadSession('c1')!.clientSessionId).toBe('cs-live');
    expect(server.count('GET', '/api/classes/c1')).toBe(0);
  });
});

describe('B15 editing a past session', () => {
  it('edit_id of another session while a class is in progress is blocked; nothing is fetched or overwritten', async () => {
    storeLive();
    const before = stored();
    renderApp(client, '/classes/c1/classroom?edit_id=x1');
    await screen.findByText('有正在进行的课堂');
    expect(stored()).toBe(before);
    expect(server.count('GET', '/api/sessions/x1')).toBe(0);
  });

  it('without a draft: re-reads the record even if cached, initialises once, later refreshes do not rebuild it', async () => {
    client.setQueryData(sessionKeys.detail('x1'), f.sessionDetail({ lessonTitle: '缓存里的旧标题' }));
    const latest = deferred<Response>();
    server.on('GET', '/api/sessions/x1', () => latest.promise);
    server.on('GET', '/api/classes/c1', detail);
    renderApp(client, '/classes/c1/classroom?edit_id=x1');
    await screen.findByText('加载课堂…');
    expect(loadSession('c1')).toBeNull();

    latest.resolve(json(f.sessionDetail({ lessonTitle: '最新标题' })));
    await screen.findByText(/最新标题/);
    expect(loadSession('c1')!.editOfSessionId).toBe('x1');
    expect(loadSession('c1')!.lessonTitle).toBe('最新标题');
    const before = stored();

    server.on('GET', '/api/sessions/x1', f.sessionDetail({ lessonTitle: '别处又改了' }));
    await act(() => client.invalidateQueries());
    await act(async () => {});
    expect(stored()).toBe(before);
    expect(screen.queryByText(/别处又改了/)).toBeNull();
  });

  it('an existing local edit draft is resumed, not rebuilt from the server', async () => {
    storeLive({ editOfSessionId: 'x1', lessonTitle: '我的编辑草稿' });
    renderApp(client, '/classes/c1/classroom?edit_id=x1');
    expect(screen.getByText(/我的编辑草稿/)).toBeTruthy();
    expect(server.count('GET', '/api/sessions/x1')).toBe(0);
  });

  it('a session belonging to another class sends the teacher to setup instead', async () => {
    server.on('GET', '/api/sessions/x1', f.sessionDetail({ classId: 'c2' }));
    server.on('GET', '/api/classes/c1', detail);
    renderApp(client, '/classes/c1/classroom?edit_id=x1');
    await screen.findByRole('button', { name: /开始课堂/ });
    expect(loadSession('c1')).toBeNull();
  });
});

describe('URL boot', () => {
  it('waits for the latest roster, creates exactly one classroom under StrictMode, and keeps it through refetches', async () => {
    const uuid = vi.spyOn(crypto, 'randomUUID');
    client.setQueryData(classKeys.detail('c1'), f.classDetail({ students: [f.student({ name: '缓存旧名单' })] }));
    server.on('GET', '/api/classes/c1', detail);
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/classes/c1/classroom?lesson=8&duration=90']}>
            <App />
          </MemoryRouter>
        </QueryClientProvider>
      </StrictMode>,
    );
    await screen.findAllByText('Amy');
    expect(screen.queryByText('缓存旧名单')).toBeNull();
    expect(uuid).toHaveBeenCalledTimes(1);
    const id = loadSession('c1')!.clientSessionId;
    expect(loadSession('c1')!.plannedDurationMin).toBe(90);

    await act(() => client.invalidateQueries());
    await act(async () => {});
    expect(loadSession('c1')!.clientSessionId).toBe(id);
    expect(uuid).toHaveBeenCalledTimes(1);
  });
});

describe('B16 ending the class', () => {
  async function endClass() {
    fireEvent.click(screen.getByRole('button', { name: /结束课堂/ }));
    fireEvent.click(await screen.findByRole('button', { name: '确认结束' }));
  }

  it('a failed commit keeps class + backup; the retry sends the identical frozen payload; success commits once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T12:00:00'));
    storeLive();
    server.on('POST', '/api/classes/c1/sessions', offline);
    renderApp(client, '/classes/c1/classroom');
    await endClass();
    await screen.findByText(/课堂数据已在本机备份/);
    expect(loadSession('c1')).not.toBeNull();
    const backup = localStorage.getItem('nce.classroom.backup.cs-live');
    expect(backup).not.toBeNull();
    const firstBody = server.last('POST', '/api/classes/c1/sessions')!.rawBody;

    vi.setSystemTime(new Date('2026-10-07T12:07:00'));
    const failureToasts = screen.getAllByText(/保存失败/).length;
    server.on('POST', '/api/classes/c1/sessions', { sessionId: 'x99', recap: f.recap(), created: true });
    server.on('GET', '/api/sessions/x99', () => json({ error: '服务器错误' }, 500));
    fireEvent.click(screen.getByRole('button', { name: '返回课堂' }));
    await endClass();
    await screen.findByText(/本节课已保存/);
    expect(server.last('POST', '/api/classes/c1/sessions')!.rawBody).toBe(firstBody);
    expect(JSON.parse(firstBody!).clientSessionId).toBe('cs-live');
    expect(loadSession('c1')).toBeNull();
    expect(localStorage.getItem('nce.classroom.backup.cs-live')).toBeNull();

    await screen.findByText('课堂加载失败');
    expect(server.count('POST', '/api/classes/c1/sessions')).toBe(2);
    expect(screen.queryAllByText(/保存失败/).length).toBeLessThanOrEqual(failureToasts);
  });

  it('offline refresh → network back → commit succeeds: identity is re-read and the detail page opens', async () => {
    client.removeQueries({ queryKey: authKeys.me() });
    client.setQueryDefaults(authKeys.all, { retryDelay: 0 });
    storeLive();
    server.on('GET', '/api/me', offline);
    renderApp(client, '/classes/c1/classroom');
    await waitFor(() => expect(server.count('GET', '/api/me')).toBe(2));

    server.on('GET', '/api/me', f.me());
    server.on('POST', '/api/classes/c1/sessions', { sessionId: 'x99', recap: f.recap(), created: true });
    server.on('GET', '/api/sessions/x99', f.sessionDetail({ id: 'x99' }));
    await endClass();
    await screen.findByRole('heading', { name: /Too late/ });
    expect(screen.queryByText('无法读取登录状态')).toBeNull();
  });

  it('a 401 at commit sends the teacher to login but keeps the classroom and its backup', async () => {
    storeLive();
    server.on('POST', '/api/classes/c1/sessions', () => json({ error: 'unauthorized' }, 401));
    renderApp(client, '/classes/c1/classroom');
    await endClass();
    await screen.findByPlaceholderText('如 wangli');
    expect(loadSession('c1')!.clientSessionId).toBe('cs-live');
    expect(localStorage.getItem('nce.classroom.backup.cs-live')).not.toBeNull();
  });

  it('editing a past session overwrites it in place and lands on its detail', async () => {
    storeLive({ editOfSessionId: 'x1', endedAt: '2026-10-07 20:00:00' });
    server.on('PUT', '/api/sessions/x1/commit', { sessionId: 'x1', recap: f.recap(), created: false });
    server.on('GET', '/api/sessions/x1', f.sessionDetail());
    renderApp(client, '/classes/c1/classroom');
    fireEvent.click(screen.getByRole('button', { name: /保存修改/ }));
    fireEvent.click(await screen.findByRole('button', { name: '确认保存' }));
    await screen.findByText('本节课已更新');
    await screen.findByRole('heading', { name: /Too late/ });
    expect(server.count('POST', '/api/classes/c1/sessions')).toBe(0);
    expect(loadSession('c1')).toBeNull();
  });
});

describe('discarding the class', () => {
  it('a wrong password keeps everything; the right one clears the local class', async () => {
    storeLive();
    server.on('POST', '/api/auth/verify-password', () => json({ error: '密码错误' }, 403));
    renderApp(client, '/classes/c1/classroom');
    fireEvent.click(screen.getByRole('button', { name: /结束课堂/ }));
    fireEvent.click(await screen.findByRole('button', { name: /丢弃本次上课/ }));
    fireEvent.change(screen.getByPlaceholderText('输入你的登录密码以确认'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: '放弃并退出' }));
    await screen.findByText('密码错误');
    expect(loadSession('c1')).not.toBeNull();

    server.on('POST', '/api/auth/verify-password', { ok: true });
    server.on('GET', '/api/classes/c1', detail);
    fireEvent.change(screen.getByPlaceholderText('输入你的登录密码以确认'), { target: { value: 'demo1234' } });
    fireEvent.click(screen.getByRole('button', { name: '放弃并退出' }));
    await screen.findByRole('heading', { name: '三年级A班' });
    expect(loadSession('c1')).toBeNull();
  });
});

describe('setup', () => {
  it('waits for the latest roster before building groups, defaults the teacher to me, starts one local class', async () => {
    client.setQueryData(classKeys.detail('c1'), f.classDetail({ students: [f.student({ name: '缓存旧名单' })] }));
    const latest = deferred<Response>();
    server.on('GET', '/api/classes/c1', () => latest.promise);
    server.on('GET', '/api/teachers', [f.teacher(), f.teacher({ id: 't2', name: '李老师' })]);
    server.on('GET', '/api/sessions/x1', f.sessionDetail());
    renderApp(client, '/classes/c1/setup');
    await waitFor(() => expect(server.count('GET', '/api/classes/c1')).toBe(1));
    expect(screen.queryByText('缓存旧名单')).toBeNull();

    latest.resolve(json(detail));
    await screen.findAllByText('Amy');
    expect((screen.getByDisplayValue('王丽') as HTMLSelectElement).value).toBe('t1');
    fireEvent.click(screen.getByRole('button', { name: /开始课堂/ }));
    await screen.findByRole('button', { name: /结束课堂/ });
    const s = loadSession('c1')!;
    expect(s.teacherId).toBe('t1');
    expect(s.students.map((x) => x.id).sort()).toEqual(['s1', 's2']);
  });

  it('a stored classroom sends setup straight back to it', async () => {
    storeLive();
    renderApp(client, '/classes/c1/setup');
    await screen.findByRole('button', { name: /结束课堂/ });
    expect(server.count('GET', '/api/classes/c1')).toBe(0);
  });

  it('the previous-lesson card reuses the class and session queries; no previous lesson is a normal empty state', async () => {
    server.on('GET', '/api/classes/c1', { ...detail, sessions: [] });
    server.on('GET', '/api/teachers', [f.teacher()]);
    renderApp(client, '/classes/c1/setup');
    await screen.findByText('本班还没有上课记录');
    expect(server.calls.filter((c) => c.url.startsWith('/api/sessions/'))).toHaveLength(0);
  });
});
