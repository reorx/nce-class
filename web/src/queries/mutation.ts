import { useMutation, useQueryClient, type MutationKey, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { sessionGeneration } from './session';

// 领域 Mutation 的共同骨架：
// - 缓存维护（回写 / 失效 / 删除）写在 hook 层的 onSuccess，组件卸载也照常执行；
//   组件只用 mutateAsync 的结果做 Toast、关弹窗、导航，不能覆盖这里的 onSuccess。
// - onSuccess 返回的 promise 会被等待：按钮保持 pending 直到相关活跃查询刷新完。
//   失效刷新失败不会让写操作变成失败（invalidateQueries 默认不抛错）。
// - 发起时记下会话代次，完成时身份已切换 → 跳过所有缓存写入。

interface AppMutationOptions<TData, TVariables, TContext> {
  mutationKey?: MutationKey;
  mutationFn: (variables: TVariables) => Promise<TData>;
  /** 发请求前执行（如占用考勤格）；抛错则请求不发出，onError 拿到的 context 为 undefined。 */
  onMutate?: (client: QueryClient, variables: TVariables) => TContext | Promise<TContext>;
  onSuccess?: (client: QueryClient, data: TData, variables: TVariables, context: TContext) => Promise<unknown> | void;
  onError?: (client: QueryClient, error: Error, variables: TVariables, context: TContext | undefined) => void;
  /** 无论成败都执行（不受会话代次限制），用于释放 onMutate 占用的资源。 */
  onSettled?: (client: QueryClient, variables: TVariables, context: TContext | undefined) => void;
  gcTime?: number;
}

interface GuardedContext<TContext> {
  generation: number;
  value: TContext;
}

export function useAppMutation<TData, TVariables, TContext = undefined>(
  options: AppMutationOptions<TData, TVariables, TContext>,
) {
  const client = useQueryClient();
  const current = (ctx: GuardedContext<TContext> | undefined) =>
    ctx !== undefined && ctx.generation === sessionGeneration(client);

  return useMutation<TData, Error, TVariables, GuardedContext<TContext>>({
    mutationKey: options.mutationKey,
    gcTime: options.gcTime,
    mutationFn: options.mutationFn,
    onMutate: async (variables) => ({
      generation: sessionGeneration(client),
      value: (await options.onMutate?.(client, variables)) as TContext,
    }),
    onSuccess: (data, variables, ctx) =>
      current(ctx) ? options.onSuccess?.(client, data, variables, ctx.value) : undefined,
    onError: (error, variables, ctx) => {
      if (ctx === undefined || current(ctx)) options.onError?.(client, error, variables, ctx?.value);
    },
    onSettled: (_data, _error, variables, ctx) => options.onSettled?.(client, variables, ctx?.value),
  });
}

/**
 * 带密码的写操作：完成（成功或失败）后立即 reset，且 gcTime 0，避免密码留在 Mutation 状态里。
 * 因此 error / data 不会停留在返回值上——调用方用 mutateAsync 的结果处理成功与错误提示。
 */
export function useSensitiveMutation<TData, TVariables>(
  options: Omit<AppMutationOptions<TData, TVariables, undefined>, 'gcTime' | 'onMutate'>,
) {
  const mutation = useAppMutation<TData, TVariables>({ ...options, gcTime: 0 });
  useResetWhenSettled(mutation);
  return mutation;
}

export function useResetWhenSettled(mutation: { isSuccess: boolean; isError: boolean; reset: () => void }) {
  const settled = mutation.isSuccess || mutation.isError;
  const { reset } = mutation;
  useEffect(() => {
    if (settled) reset();
  }, [settled, reset]);
}
