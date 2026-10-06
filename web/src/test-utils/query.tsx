import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

/** 在独立 QueryClient 下渲染 hook（每个用例自建 client，不共享生产缓存）。 */
export function renderWithClient<TResult, TProps>(
  client: QueryClient,
  hook: (props: TProps) => TResult,
  initialProps?: TProps,
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(hook, { wrapper, initialProps });
}
