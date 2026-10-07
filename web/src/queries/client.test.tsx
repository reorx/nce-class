// @vitest-environment jsdom
import { act, cleanup, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../api/client';
import { batchDetail, classDetail, classListItem, invoiceLessons } from '../test-utils/fixtures';
import { deferred, installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import { renderWithClient } from '../test-utils/query';
import { useBillingBatchQuery, useInvoiceLessonsQuery, usePrefetchBillingBatch } from './billing';
import { useClassesQuery, useClassQuery } from './classes';
import { createQueryClient, GC_TIME, setBackgroundErrorHandler, shouldRetryQuery, STALE_TIME } from './client';
import { classKeys } from './keys';

let server: FakeServer;
let client: QueryClient;

beforeEach(() => {
  server = installFakeFetch();
  client = createQueryClient();
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  server.restore();
});

describe('cache sharing and freshness', () => {
  it('dedupes concurrent observers of the same key into one request', async () => {
    server.on('GET', '/api/classes', [classListItem()]);
    const { result } = renderWithClient(client, () => [useClassesQuery(), useClassesQuery()]);
    await waitFor(() => expect(result.current[1].isSuccess).toBe(true));
    expect(result.current[0].data).toEqual([classListItem()]);
    expect(server.count('GET', '/api/classes')).toBe(1);
  });

  it('remounting within staleTime renders cached data on the first frame with no new request', async () => {
    server.on('GET', '/api/classes', [classListItem()]);
    const first = renderWithClient(client, () => useClassesQuery());
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderWithClient(client, () => useClassesQuery());
    expect(second.result.current.data).toEqual([classListItem()]);
    expect(second.result.current.isFetching).toBe(false);
    expect(server.count('GET', '/api/classes')).toBe(1);
  });

  it('remounting after staleTime keeps showing cached data while refreshing in the background', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    server.on('GET', '/api/classes', [classListItem({ name: '旧名' })]);
    const first = renderWithClient(client, () => useClassesQuery());
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    vi.setSystemTime(new Date(Date.now() + STALE_TIME + 1));
    const slow = deferred<Response>();
    server.on('GET', '/api/classes', () => slow.promise);
    const second = renderWithClient(client, () => useClassesQuery());
    expect(second.result.current.data?.[0].name).toBe('旧名');
    await waitFor(() => expect(second.result.current.isFetching).toBe(true));
    expect(second.result.current.isPending).toBe(false);

    slow.resolve(json([classListItem({ name: '新名' })]));
    await waitFor(() => expect(second.result.current.data?.[0].name).toBe('新名'));
    expect(server.count('GET', '/api/classes')).toBe(2);
  });

  it('keeps an unobserved query until gcTime, then the next mount is a cold load', async () => {
    server.on('GET', '/api/classes', [classListItem()]);
    const first = renderWithClient(client, () => useClassesQuery());
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    vi.useFakeTimers();
    first.unmount();
    vi.advanceTimersByTime(GC_TIME - 1);
    expect(client.getQueryData(classKeys.lists())).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(client.getQueryState(classKeys.lists())).toBeUndefined();
    vi.useRealTimers();

    const second = renderWithClient(client, () => useClassesQuery());
    expect(second.result.current.isPending).toBe(true);
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(server.count('GET', '/api/classes')).toBe(2);
  });

  it('isolates different entity ids', async () => {
    server.on('GET', '/api/classes/c1', classDetail({ id: 'c1', name: 'A班' }));
    server.on('GET', '/api/classes/c2', classDetail({ id: 'c2', name: 'B班' }));
    const { result } = renderWithClient(client, () => [useClassQuery('c1'), useClassQuery('c2')]);
    await waitFor(() => expect(result.current.every((q) => q.isSuccess)).toBe(true));
    expect(result.current.map((q) => q.data?.name)).toEqual(['A班', 'B班']);
  });

  it('does not request anything while the id is missing', async () => {
    const { result } = renderWithClient(client, () => useClassQuery(undefined));
    await act(async () => {});
    expect(result.current.fetchStatus).toBe('idle');
    expect(server.fetchMock).not.toHaveBeenCalled();
  });

  it('passes the query signal to fetch so cancelling aborts the request without an error state', async () => {
    const slow = deferred<Response>();
    server.on('GET', '/api/classes', () => slow.promise);
    const notify = vi.fn();
    setBackgroundErrorHandler(client, notify);
    const { result } = renderWithClient(client, () => useClassesQuery());
    await waitFor(() => expect(server.count('GET', '/api/classes')).toBe(1));

    await act(() => client.cancelQueries({ queryKey: classKeys.lists() }));
    expect(server.last('GET', '/api/classes')!.signal!.aborted).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('on-demand reads', () => {
  it('a modal read waits for open + id, then loads once', async () => {
    server.on('GET', '/api/invoices/i1/lessons', invoiceLessons());
    type Props = { open: boolean; id?: string };
    const closed: Props = { open: false, id: 'i1' };
    const { result, rerender } = renderWithClient(
      client,
      (props: Props) => useInvoiceLessonsQuery(props.id, { enabled: props.open }),
      closed,
    );
    rerender({ open: true, id: undefined });
    await act(async () => {});
    expect(server.fetchMock).not.toHaveBeenCalled();

    rerender({ open: true, id: 'i1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(server.count('GET', '/api/invoices/i1/lessons')).toBe(1);
  });

  it('prefetching a batch detail lets the detail page render without waiting; fresh prefetch is a no-op', async () => {
    server.on('GET', '/api/billing/batches/b1', batchDetail());
    const prefetch = renderWithClient(client, () => usePrefetchBillingBatch());
    await act(() => prefetch.result.current('b1'));
    await act(() => prefetch.result.current('b1'));
    expect(server.count('GET', '/api/billing/batches/b1')).toBe(1);

    const page = renderWithClient(client, () => useBillingBatchQuery('b1'));
    expect(page.result.current.data).toEqual(batchDetail());
    expect(page.result.current.isFetching).toBe(false);
  });
});

describe('retry policy', () => {
  it('retries network errors and 5xx once; never 4xx', () => {
    expect(shouldRetryQuery(0, new NetworkError(new TypeError('x')))).toBe(true);
    expect(shouldRetryQuery(0, new ApiError(502, 'x'))).toBe(true);
    expect(shouldRetryQuery(1, new ApiError(502, 'x'))).toBe(false);
    for (const status of [400, 401, 403, 404, 409]) expect(shouldRetryQuery(0, new ApiError(status, 'x'))).toBe(false);
  });

  it('a transient 500 recovers on the single retry', async () => {
    client.setQueryDefaults(classKeys.all, { retryDelay: 0 });
    let n = 0;
    server.on('GET', '/api/classes', () => (n++ === 0 ? json({ error: 'boom' }, 500) : json([classListItem()])));
    const { result } = renderWithClient(client, () => useClassesQuery());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(server.count('GET', '/api/classes')).toBe(2);
  });

  it('a 404 fails immediately', async () => {
    server.on('GET', '/api/classes/nope', () => json({ error: 'class not found' }, 404));
    const { result } = renderWithClient(client, () => useClassQuery('nope'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).status).toBe(404);
    expect(server.count('GET', '/api/classes/nope')).toBe(1);
  });
});

describe('background error notification', () => {
  it('first-load failures are left to the page (no notification)', async () => {
    const notify = vi.fn();
    setBackgroundErrorHandler(client, notify);
    server.on('GET', '/api/classes/c1', () => json({ error: 'class not found' }, 404));
    const { result } = renderWithClient(client, () => useClassQuery('c1'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(notify).not.toHaveBeenCalled();
  });

  it('a failed background refresh keeps the data and notifies once regardless of observer count', async () => {
    const notify = vi.fn();
    setBackgroundErrorHandler(client, notify);
    server.on('GET', '/api/classes/c1', classDetail());
    const { result } = renderWithClient(client, () => [useClassQuery('c1'), useClassQuery('c1')]);
    await waitFor(() => expect(result.current[0].isSuccess).toBe(true));

    server.on('GET', '/api/classes/c1', () => json({ error: 'forbidden' }, 403));
    await act(() => client.invalidateQueries({ queryKey: classKeys.detail('c1') }));
    await waitFor(() => expect(result.current[0].isError).toBe(true));
    expect(result.current[0].data).toEqual(classDetail());
    expect(result.current[1].data).toEqual(classDetail());
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBeInstanceOf(ApiError);
  });
});
