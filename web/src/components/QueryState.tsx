import type { CSSProperties, ReactNode } from 'react';
import { loadErrorText, queryView } from '../lib/queryView';

// 页面读取状态的统一展示（口径见 lib/queryView）：
// 没数据时显示加载 / 错误块；有数据就照常展示，后台刷新与刷新失败只在 RefreshStatus 里轻量提示。

interface QueryLike<T> {
  data: T | undefined;
  error: Error | null;
  isError: boolean;
  isFetching: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  refetch: () => unknown;
}

const blockStyle: CSSProperties = {
  padding: '72px 20px',
  textAlign: 'center',
  color: '#9aa1ac',
  fontSize: 13.5,
};

export function LoadingBlock({ label = '加载中…', style }: { label?: string; style?: CSSProperties }) {
  return (
    <div role="status" style={{ ...blockStyle, ...style }}>
      {label}
    </div>
  );
}

/** 首次读取失败：404 不存在、403 无权限（不给重试），其余给原因与重试按钮。 */
export function LoadErrorBlock({
  error,
  what,
  onRetry,
  style,
}: {
  error: unknown;
  what: string;
  onRetry: () => unknown;
  style?: CSSProperties;
}) {
  const t = loadErrorText(error, what);
  return (
    <div role="alert" style={{ ...blockStyle, ...style }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#3c4451' }}>{t.title}</div>
      {t.detail && <div style={{ marginTop: 6 }}>{t.detail}</div>}
      {t.retry && (
        <button onClick={() => onRetry()} style={retryBtn}>
          重试
        </button>
      )}
    </div>
  );
}

/**
 * 按查询状态渲染：有数据 → children(data)；首次加载 → 加载块；首次失败 → 错误块；
 * 未启用（条件未满足）→ idle（默认不渲染，不显示永久加载）。
 */
export function QueryBlock<T>({
  query,
  what,
  children,
  loading,
  idle = null,
  style,
}: {
  query: QueryLike<T>;
  what: string;
  children: (data: T) => ReactNode;
  loading?: ReactNode;
  idle?: ReactNode;
  style?: CSSProperties;
}) {
  const view = queryView(query);
  if (view === 'ready') return <>{children(query.data as T)}</>;
  if (view === 'error') return <LoadErrorBlock error={query.error} what={what} onRetry={query.refetch} style={style} />;
  if (view === 'idle') return <>{idle}</>;
  return <>{loading ?? <LoadingBlock style={style} />}</>;
}

/** 标题旁的轻量状态：已有内容时「刷新中…」或「刷新失败 · 重试」。没有数据时不显示（交给 QueryBlock）。 */
export function RefreshStatus<T>({ query, style }: { query: QueryLike<T>; style?: CSSProperties }) {
  if (query.data === undefined) return null;
  if (query.isFetching) {
    return (
      <span role="status" style={{ ...statusStyle, ...style }}>
        刷新中…
      </span>
    );
  }
  if (!query.isError) return null;
  return (
    <span role="alert" style={{ ...statusStyle, color: '#c0392b', ...style }}>
      刷新失败，显示的是之前的内容 ·{' '}
      <button onClick={() => query.refetch()} style={linkBtn}>
        重试
      </button>
    </span>
  );
}

const retryBtn: CSSProperties = {
  marginTop: 14,
  height: 34,
  padding: '0 18px',
  border: '1px solid #e2e5ea',
  borderRadius: 9,
  background: '#fff',
  color: '#3c4451',
  fontWeight: 600,
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
};
const statusStyle: CSSProperties = { fontSize: 12, fontWeight: 500, color: '#9aa1ac' };
const linkBtn: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  color: 'inherit',
  fontSize: 'inherit',
  fontWeight: 700,
  fontFamily: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
};
