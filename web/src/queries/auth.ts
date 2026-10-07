import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMe, login, logout, verifyPassword, type Me } from '../api/auth';
import { isUnauthorized } from './client';
import { authKeys } from './keys';
import { useResetWhenSettled, useSensitiveMutation } from './mutation';
import { switchSession } from './session';

// 身份只有一个来源：me 查询。data === null 表示未登录（/api/me 401），
// undefined + error 表示读取失败（断网 / 5xx / 403），不能当成退出。

function nullWhenUnauthorized(error: unknown): null {
  if (isUnauthorized(error)) return null;
  throw error;
}

export const meQueryOptions = () =>
  queryOptions({
    queryKey: authKeys.me(),
    queryFn: ({ signal }): Promise<Me | null> => getMe({ signal }).catch(nullWhenUnauthorized),
  });

export const useMeQuery = () => useQuery(meQueryOptions());

export type AuthStatus = 'loading' | 'in' | 'out' | 'error';

/**
 * 路由守卫用的身份状态：有 me = 已登录（后台刷新失败也保持登录）；null = 未登录；
 * 没有数据且读取失败（断网 / 5xx / 403）= error，要给重试而不是当成退出。
 */
export function authStatus(q: { data: Me | null | undefined; isError: boolean }): AuthStatus {
  if (q.data) return 'in';
  if (q.data === null) return 'out';
  return q.isError ? 'error' : 'loading';
}

export interface LoginVariables {
  username: string;
  password: string;
}

/** 登录成功：隔离旧会话（代次 +1、取消并清空缓存），再用登录响应写入 me。密码错误（401）留在表单。 */
export function useLoginMutation() {
  const client = useQueryClient();
  const mutation = useMutation({
    meta: { loginFlow: true },
    gcTime: 0,
    mutationFn: ({ username, password }: LoginVariables) => login(username, password),
    onSuccess: (me) => switchSession(client, me),
  });
  useResetWhenSettled(mutation);
  return mutation;
}

/** 退出成功才清缓存；HTTP 失败如实报错，不假装服务端 cookie 已清理。本地课堂草稿不受影响。 */
export function useLogoutMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => logout(),
    onSuccess: () => switchSession(client, null),
  });
}

/** 危险操作前复核密码；密码错误是 403，会话保持有效。 */
export function useVerifyPasswordMutation() {
  return useSensitiveMutation({
    mutationFn: ({ password }: { password: string }) => verifyPassword(password),
  });
}
