import { hashKey, type QueryClient } from '@tanstack/react-query';
import type { Me } from '../api/auth';
import { authKeys } from './keys';

// 登录会话代次：每次身份切换（登录 / 退出 / 已认证请求 401）+1。
// 写操作在开始时记下代次，完成时代次已变 → 不再向缓存写任何东西，
// 防止上一个账号的晚到响应污染新账号的缓存。
// 只管服务端数据缓存；课堂 localStorage（nce.classroom.*）与提交备份从不在这里清理。

const generations = new WeakMap<QueryClient, number>();

export const sessionGeneration = (client: QueryClient): number => generations.get(client) ?? 0;

const isMe = (query: { queryHash: string }) => query.queryHash === hashKey(authKeys.me());

/**
 * 切换到新身份（null = 未登录）：代次 +1 → 取消在途查询 → 清除除 me 以外的全部查询 → 写入 me。
 * me 查询保留同一对象原地更新，挂着的 useMeQuery 观察者能立刻看到新身份。
 */
export async function switchSession(client: QueryClient, me: Me | null): Promise<void> {
  generations.set(client, sessionGeneration(client) + 1);
  await client.cancelQueries();
  client.removeQueries({ predicate: (query) => !isMe(query) });
  client.setQueryData<Me | null>(authKeys.me(), me);
}

/** 已认证请求收到 401：当前会话已失效。已是未登录状态时不重复处理（避免多个 401 反复清缓存）。 */
export function expireSession(client: QueryClient): Promise<void> | undefined {
  if (client.getQueryData(authKeys.me()) === null) return undefined;
  return switchSession(client, null);
}

/** me 重新读取得到 null（会话已在别处失效）：me 已是 null，只需丢弃其余服务端数据。 */
export function dropSessionData(client: QueryClient): void {
  generations.set(client, sessionGeneration(client) + 1);
  void client.cancelQueries({ predicate: (query) => !isMe(query) });
  client.removeQueries({ predicate: (query) => !isMe(query) });
}

/** QueryCache.onSuccess 用：判断这次成功的是不是「me 读到未登录」。 */
export const isSignedOutResult = (data: unknown, query: { queryHash: string }) => data === null && isMe(query);
