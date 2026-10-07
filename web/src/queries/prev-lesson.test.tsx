// @vitest-environment jsdom
import { act, cleanup, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deferred, installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import * as f from '../test-utils/fixtures';
import { renderWithClient } from '../test-utils/query';
import { useClassQuery } from './classes';
import { createQueryClient } from './client';
import { usePrevLessonQuery } from './prev-lesson';

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

describe('usePrevLessonQuery', () => {
  it('derives the latest ended session from the class, then reads its detail', async () => {
    server.on(
      'GET',
      '/api/classes/c1',
      f.classDetail({ sessions: [f.session({ id: 'x2', lessonNumber: 8 }), f.session({ id: 'x1' })] }),
    );
    server.on('GET', '/api/sessions/x2', f.sessionDetail({ id: 'x2', homeworkContent: '背第8课' }));
    const { result } = renderWithClient(client, () => usePrevLessonQuery('c1'));
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data).toMatchObject({
      info: { sessionId: 'x2' },
      homework: '背第8课',
      groups: [
        { name: '狮子组', score: 5 },
        { name: '海豚组', score: 3 },
      ],
      stars: [{ name: 'Tom', net: 3 }],
    });
    expect(server.calls.map((c) => c.url)).toEqual(['/api/classes/c1', '/api/sessions/x2']);
  });

  it('no previous session is a normal empty state and never requests an empty id', async () => {
    server.on('GET', '/api/classes/c1', f.classDetail({ sessions: [] }));
    const { result } = renderWithClient(client, () => usePrevLessonQuery('c1'));
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data).toBeNull();
    expect(server.calls.map((c) => c.url)).toEqual(['/api/classes/c1']);
  });

  it('hides homework when the session has none assigned', async () => {
    server.on('GET', '/api/classes/c1', f.classDetail({ sessions: [f.session({ hasHomework: false })] }));
    server.on('GET', '/api/sessions/x1', f.sessionDetail({ homeworkContent: '残留文本' }));
    const { result } = renderWithClient(client, () => usePrevLessonQuery('c1'));
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data?.homework).toBeNull();
  });

  it('shares the class detail cache with other readers (one request)', async () => {
    const cls = deferred<Response>();
    server.on('GET', '/api/classes/c1', () => cls.promise);
    server.on('GET', '/api/sessions/x1', f.sessionDetail());
    const { result } = renderWithClient(client, () => ({ prev: usePrevLessonQuery('c1'), cls: useClassQuery('c1') }));
    expect(result.current.prev.status).toBe('pending');
    cls.resolve(json(f.classDetail()));
    await waitFor(() => expect(result.current.prev.status).toBe('success'));
    expect(server.count('GET', '/api/classes/c1')).toBe(1);
  });

  it('a failed step reports an error and refetch retries only that step', async () => {
    server.on('GET', '/api/classes/c1', f.classDetail());
    server.on('GET', '/api/sessions/x1', () => json({ error: 'session not found' }, 404));
    const { result } = renderWithClient(client, () => usePrevLessonQuery('c1'));
    await waitFor(() => expect(result.current.status).toBe('error'));

    server.on('GET', '/api/sessions/x1', f.sessionDetail());
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(server.count('GET', '/api/classes/c1')).toBe(1);
    expect(server.count('GET', '/api/sessions/x1')).toBe(2);
  });

  it('a missing classId stays pending without any request', async () => {
    const { result } = renderWithClient(client, () => usePrevLessonQuery(undefined));
    await act(async () => {});
    expect(result.current.status).toBe('pending');
    expect(server.fetchMock).not.toHaveBeenCalled();
  });
});
