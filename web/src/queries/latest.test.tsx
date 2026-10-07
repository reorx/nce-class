// @vitest-environment jsdom
import { cleanup, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deferred, installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import { classDetail, sessionDetail } from '../test-utils/fixtures';
import { renderWithClient } from '../test-utils/query';
import { useLatestClassQuery } from './classes';
import { createQueryClient } from './client';
import { classKeys, sessionKeys } from './keys';
import { useLatestSessionQuery } from './sessions';

// 用来初始化草稿（开新课的名单、编辑上课记录的底稿）的读取：即便缓存新鲜也在挂载时重读一次，
// 调用方等 isFetchedAfterMount 才使用，避免把旧缓存固化成草稿。

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

describe('latest reads for draft initialisation', () => {
  it('a fresh cached class detail is shown but re-read once; isFetchedAfterMount flips only after the read', async () => {
    client.setQueryData(classKeys.detail('c1'), classDetail({ name: '旧名' }));
    const slow = deferred<Response>();
    server.on('GET', '/api/classes/c1', () => slow.promise);
    const { result } = renderWithClient(client, () => {
      const q = useLatestClassQuery('c1');
      return { q, data: q.data, after: q.isFetchedAfterMount };
    });
    expect(result.current.data?.name).toBe('旧名');
    expect(result.current.after).toBe(false);
    await waitFor(() => expect(server.count('GET', '/api/classes/c1')).toBe(1));

    slow.resolve(json(classDetail({ name: '新名' })));
    await waitFor(() => expect(result.current.after).toBe(true));
    expect(result.current.data?.name).toBe('新名');
  });

  it('the session variant behaves the same; disabled it stays idle', async () => {
    client.setQueryData(sessionKeys.detail('x1'), sessionDetail());
    server.on('GET', '/api/sessions/x1', sessionDetail({ lessonTitle: '最新' }));
    const idle = renderWithClient(client, () => useLatestSessionQuery('x1', { enabled: false }).fetchStatus);
    expect(idle.result.current).toBe('idle');
    idle.unmount();
    expect(server.count('GET', '/api/sessions/x1')).toBe(0);

    const { result } = renderWithClient(client, () => {
      const q = useLatestSessionQuery('x1');
      return { q, data: q.data, after: q.isFetchedAfterMount };
    });
    await waitFor(() => expect(result.current.after).toBe(true));
    expect(result.current.data?.lessonTitle).toBe('最新');
    expect(server.count('GET', '/api/sessions/x1')).toBe(1);
  });
});
