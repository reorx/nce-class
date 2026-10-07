import { MutationCache, QueryCache, QueryClient, type Mutation, type Query } from '@tanstack/react-query';
import { ApiError, NetworkError } from '../api/client';
import { authKeys } from './keys';
import { dropSessionData, expireSession, isSignedOutResult, sessionGeneration } from './session';

// 应用唯一的 QueryClient（main.tsx 根部 Provider，不随路由重建）；测试每例 createQueryClient() 一个新的。
// 缓存只在内存：不持久化、不跨标签广播，也不承担多端实时同步——
// 聚焦 / 重连 / 手动刷新用来发现其他老师或小程序造成的变化。

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** 登录：401 表示用户名或密码错误，不是「当前会话过期」。 */
      loginFlow?: boolean;
    };
  }
}

/** 普通业务查询：30 秒内重挂载直接用缓存；过期只表示允许后台刷新，不是定时请求。 */
export const STALE_TIME = 30_000;
/** 很少变化的字典类（老师列表、奖章库）。 */
export const LONG_STALE_TIME = 5 * 60_000;
/** 无订阅后 30 分钟回收；回收前返回页面可立即展示旧数据并后台刷新。 */
export const GC_TIME = 30 * 60_000;

/** 只对网络错误和 5xx 重试一次；4xx 是确定结果，取消不会走到这里。 */
export function shouldRetryQuery(failureCount: number, error: Error): boolean {
  if (failureCount >= 1) return false;
  return error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);
}

export const isUnauthorized = (error: unknown): boolean => error instanceof ApiError && error.status === 401;

export type BackgroundErrorHandler = (error: Error) => void;

const backgroundErrorHandlers = new WeakMap<QueryClient, BackgroundErrorHandler>();

/** 接入后台刷新失败通知（Plan 2 接 Toast）。返回解绑函数。 */
export function setBackgroundErrorHandler(client: QueryClient, handler: BackgroundErrorHandler): () => void {
  backgroundErrorHandlers.set(client, handler);
  return () => {
    if (backgroundErrorHandlers.get(client) === handler) backgroundErrorHandlers.delete(client);
  };
}

// QueryCache.onError 每次失败的请求只触发一次（与观察者个数无关），取消不会触发。
// 首次读取失败（还没有数据）由页面内联展示错误与重试；已有缓存的后台刷新失败才统一通知。
function onQueryError(client: QueryClient, error: Error, query: Query<unknown, unknown, unknown>) {
  if (isUnauthorized(error)) {
    void expireSession(client);
    return;
  }
  if (query.state.data !== undefined) backgroundErrorHandlers.get(client)?.(error);
}

const mutationGenerations = new WeakMap<Mutation<unknown, unknown, unknown>, number>();

// 写操作 401：只有发起时仍是当前会话、且不是登录本身，才判定为会话过期。
function onMutationError(client: QueryClient, error: Error, mutation: Mutation<unknown, unknown, unknown>) {
  if (!isUnauthorized(error) || mutation.meta?.loginFlow) return;
  if (mutationGenerations.get(mutation) !== sessionGeneration(client)) return;
  void expireSession(client);
}

/**
 * 写成功即证明会话有效：若此时身份读取失败且没有数据（断网刷新后课堂离线进行、刚恢复联网），
 * 在这次写操作 resolve 前重读 me，提交后跳转的页面不会卡在「无法读取登录状态」。重读失败不影响写操作。
 */
function onMutationSuccess(client: QueryClient) {
  const me = client.getQueryState(authKeys.me());
  if (!me || me.status !== 'error' || me.data !== undefined) return undefined;
  return client.refetchQueries({ queryKey: authKeys.me(), exact: true });
}

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => onQueryError(client, error, query),
      // /api/me 后台刷新发现已未登录（别处退出 / cookie 过期）：丢弃上一个账号的服务端数据。
      onSuccess: (data, query) => {
        if (isSignedOutResult(data, query)) dropSessionData(client);
      },
    }),
    mutationCache: new MutationCache({
      onMutate: (_variables, mutation) => {
        mutationGenerations.set(mutation, sessionGeneration(client));
      },
      onError: (error, _variables, _context, mutation) => onMutationError(client, error, mutation),
      onSuccess: () => onMutationSuccess(client),
    }),
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME,
        gcTime: GC_TIME,
        retry: shouldRetryQuery,
        // refetchOnMount / WindowFocus / Reconnect 保持默认 true：仅在过期时后台刷新，不用 'always'。
      },
      // 写操作不重试、不离线排队、不自动重放。
      mutations: { retry: false },
    },
  });
  return client;
}

export const queryClient = createQueryClient();

/** 读取 hooks 对组件开放的唯一选项；queryKey / queryFn 不可覆盖。 */
export interface QueryHookOptions {
  enabled?: boolean;
}

/** 缺 ID 时禁用（不会请求空字符串路径），否则听调用方的 enabled。 */
export const enabledWith = (id: string | undefined, options?: QueryHookOptions): boolean =>
  Boolean(id) && options?.enabled !== false;
