import { ApiError, NetworkError } from '../api/client';

// 页面读取状态的统一口径（Plan 2「页面状态统一」）：按有没有数据决定内容能否展示，
// isFetching 只用于轻量刷新提示，不作为整页白屏条件。

export type LoadErrorKind = 'not-found' | 'forbidden' | 'network' | 'failed';

export function loadErrorKind(error: unknown): LoadErrorKind {
  if (error instanceof ApiError && error.status === 404) return 'not-found';
  if (error instanceof ApiError && error.status === 403) return 'forbidden';
  if (error instanceof NetworkError) return 'network';
  return 'failed';
}

/** 首次读取失败（还没有数据）时的提示文案。what = 被读取的东西，如「收款项」。 */
export function loadErrorText(error: unknown, what: string): { title: string; detail: string | null; retry: boolean } {
  const kind = loadErrorKind(error);
  if (kind === 'not-found') return { title: `${what}不存在或已被删除`, detail: null, retry: false };
  if (kind === 'forbidden') return { title: `没有权限查看${what}`, detail: null, retry: false };
  const detail = error instanceof Error ? error.message : null;
  return { title: `${what}加载失败`, detail, retry: true };
}

export type QueryView = 'loading' | 'error' | 'idle' | 'ready';

/**
 * - ready：有数据（即便正在后台刷新或刚刷新失败，内容照常展示）；
 * - error：没有数据且读取失败；
 * - idle：没有数据且查询未启用（条件未满足，不是加载中）；
 * - loading：没有数据、正在首次读取。
 */
export function queryView(q: { data: unknown; isError: boolean; fetchStatus: 'fetching' | 'paused' | 'idle' }): QueryView {
  if (q.data !== undefined) return 'ready';
  if (q.isError) return 'error';
  if (q.fetchStatus === 'idle') return 'idle';
  return 'loading';
}
