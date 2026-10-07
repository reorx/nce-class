import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

/**
 * 在独立 QueryClient 下渲染整个 App（含 Toast / 学生弹窗 Provider 与全部路由），从 path 进入。
 * 页面级行为测试用它驱动真实组件；身份由 client 里的 me 缓存或 /api/me 的假响应决定。
 */
export function renderApp(client: QueryClient, path = '/') {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
