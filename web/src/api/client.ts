// HTTP 层：老师端 cookie 会话 + JSON。只管收发与错误分类；不重试、不弹 Toast、
// 不跳登录（这些归 queries 层与页面）。领域函数见同目录 <domain>.ts。

/** 服务端返回了非 2xx。status 保留给上层区分 401 / 403 / 404 / 409 / 5xx。 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 请求没到达服务端或没拿到响应（断网、DNS、连接被重置）。取消请求不算，仍是 AbortError。 */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('网络连接失败，请检查网络后重试', { cause });
    this.name = 'NetworkError';
  }
}

/** 读取类 API 的可选参数；queryFn 把 Query 提供的 signal 透传到 fetch。 */
export interface RequestOptions {
  signal?: AbortSignal;
}

export const isAbortError = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

function toNetworkError(e: unknown): never {
  throw isAbortError(e) ? e : new NetworkError(e);
}

/** 只认 `{ error: string }` 形状；非 JSON / 坏 JSON / 缺字段 → null，由调用方兜底。 */
async function errorMessageOf(res: Response): Promise<string | null> {
  if (!res.headers.get('content-type')?.includes('application/json')) return null;
  const body: unknown = await res.json().catch((e: unknown) => {
    if (e instanceof SyntaxError) return null;
    throw e;
  });
  const message = (body as { error?: unknown } | null)?.error;
  return typeof message === 'string' && message ? message : null;
}

export async function request<T>(method: string, url: string, body?: unknown, options?: RequestOptions): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options?.signal,
  }).catch(toNetworkError);
  if (!res.ok) {
    throw new ApiError(res.status, (await errorMessageOf(res)) ?? `请求失败（HTTP ${res.status}）`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const get = <T>(url: string, options?: RequestOptions) => request<T>('GET', url, undefined, options);
