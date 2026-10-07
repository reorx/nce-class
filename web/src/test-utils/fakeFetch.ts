import { vi } from 'vitest';

/** One request as the fake server saw it (body already JSON-parsed). */
export interface FakeRequest {
  method: string;
  url: string;
  body: unknown;
  rawBody: string | undefined;
  credentials: RequestCredentials | undefined;
  headers: Record<string, string>;
  signal: AbortSignal | undefined;
}

type Handler = (req: FakeRequest) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Settle like real fetch: an aborted signal rejects with its reason (an AbortError DOMException). */
function abortable(result: Promise<Response>, signal: AbortSignal | undefined): Promise<Response> {
  if (!signal) return result;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    result.then(resolve, reject);
  });
}

/**
 * Stub global fetch with a route table keyed `'METHOD /path'`. Unknown routes reject so a test
 * never silently hits an endpoint it did not expect. Call `restore()` (or vi.unstubAllGlobals) after.
 */
export function installFakeFetch() {
  const calls: FakeRequest[] = [];
  const routes = new Map<string, Handler>();

  const fetchMock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const rawBody = typeof init.body === 'string' ? init.body : undefined;
    const req: FakeRequest = {
      method: init.method ?? 'GET',
      url: String(input),
      body: rawBody === undefined ? undefined : JSON.parse(rawBody),
      rawBody,
      credentials: init.credentials,
      headers: { ...(init.headers as Record<string, string> | undefined) },
      signal: init.signal ?? undefined,
    };
    calls.push(req);
    const handler = routes.get(`${req.method} ${req.url}`);
    if (!handler) return Promise.reject(new Error(`fakeFetch: unexpected ${req.method} ${req.url}`));
    return abortable(
      Promise.resolve().then(() => handler(req)),
      req.signal,
    );
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    calls,
    fetchMock,
    /** Register (or replace) a handler. A plain value is served as a JSON 200 each time. */
    on(method: string, url: string, handler: Handler | object) {
      routes.set(`${method} ${url}`, typeof handler === 'function' ? (handler as Handler) : () => json(handler));
    },
    count(method: string, url: string) {
      return calls.filter((c) => c.method === method && c.url === url).length;
    },
    last(method: string, url: string) {
      return calls.filter((c) => c.method === method && c.url === url).at(-1);
    },
    restore() {
      vi.unstubAllGlobals();
    },
  };
}

export type FakeServer = ReturnType<typeof installFakeFetch>;
