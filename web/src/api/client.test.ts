import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deferred, installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import { ApiError, isAbortError, NetworkError, request } from './client';

// 断言必定 reject，并取出 rejection 供断言（按 any 访问 status / cause）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const failure = (p: Promise<unknown>): Promise<any> =>
  p.then(
    () => {
      throw new Error('expected the request to reject');
    },
    (e: unknown) => e,
  );

let server: FakeServer;
beforeEach(() => {
  server = installFakeFetch();
});
afterEach(() => server.restore());

describe('request: wire contract', () => {
  it('sends the session cookie and no body/content-type when there is no payload', async () => {
    server.on('GET', '/api/me', { id: 't1' });
    await expect(request('GET', '/api/me')).resolves.toEqual({ id: 't1' });
    const call = server.last('GET', '/api/me')!;
    expect(call.credentials).toBe('include');
    expect(call.rawBody).toBeUndefined();
    expect(call.headers['Content-Type']).toBeUndefined();
  });

  it('JSON-encodes a payload and labels it', async () => {
    server.on('POST', '/api/classes', { id: 'c1' });
    await request('POST', '/api/classes', { name: '三年级A班', textbook: null });
    const call = server.last('POST', '/api/classes')!;
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(call.body).toEqual({ name: '三年级A班', textbook: null });
  });

  it('keeps "key omitted" and "explicit null / empty string" distinct in the body', async () => {
    server.on('PUT', '/api/students/s1', { id: 's1' });
    await request('PUT', '/api/students/s1', { name: 'Tom', cnName: undefined });
    expect(server.calls[0].rawBody).toBe('{"name":"Tom"}');
    await request('PUT', '/api/students/s1', { name: 'Tom', cnName: null });
    expect(server.calls[1].rawBody).toBe('{"name":"Tom","cnName":null}');
    await request('PUT', '/api/students/s1', { name: 'Tom', cnName: '' });
    expect(server.calls[2].rawBody).toBe('{"name":"Tom","cnName":""}');
  });

  it('resolves 204 to undefined without parsing', async () => {
    server.on('DELETE', '/api/x', () => new Response(null, { status: 204 }));
    await expect(request('DELETE', '/api/x')).resolves.toBeUndefined();
  });
});

describe('request: errors', () => {
  it('raises ApiError with the status and the server error message', async () => {
    server.on('POST', '/api/auth/login', () => json({ error: '用户名或密码错误' }, 401));
    const err = await failure(request('POST', '/api/auth/login', {}));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe('用户名或密码错误');
  });

  it('falls back to a stable message for a non-JSON error body', async () => {
    server.on('GET', '/api/billing/batches', () => new Response('<html>Bad Gateway</html>', { status: 502 }));
    const err = await failure(request('GET', '/api/billing/batches'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.message).toBe('请求失败（HTTP 502）');
  });

  it('falls back when a JSON-labelled error body is malformed or has no error field', async () => {
    server.on(
      'GET',
      '/api/a',
      () => new Response('{oops', { status: 500, headers: { 'content-type': 'application/json' } }),
    );
    server.on('GET', '/api/b', () => json({ message: 'nope' }, 400));
    expect((await failure(request('GET', '/api/a'))).message).toBe('请求失败（HTTP 500）');
    const b = await failure(request('GET', '/api/b'));
    expect(b.status).toBe(400);
    expect(b.message).toBe('请求失败（HTTP 400）');
  });

  it('wraps a transport failure as NetworkError (no status), distinct from ApiError', async () => {
    server.on('GET', '/api/me', () => Promise.reject(new TypeError('Failed to fetch')));
    const err = await failure(request('GET', '/api/me'));
    expect(err).toBeInstanceOf(NetworkError);
    expect(err).not.toBeInstanceOf(ApiError);
    expect(err.message).toBe('网络连接失败，请检查网络后重试');
    expect(err.cause).toBeInstanceOf(TypeError);
  });

  it('keeps cancellation an AbortError — not an ApiError or NetworkError', async () => {
    const pending = deferred<Response>();
    server.on('GET', '/api/classes', () => pending.promise);
    const ctrl = new AbortController();
    const p = request('GET', '/api/classes', undefined, { signal: ctrl.signal });
    ctrl.abort();
    const err = await failure(p);
    expect(isAbortError(err)).toBe(true);
    expect(err).not.toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(NetworkError);
    expect(server.last('GET', '/api/classes')!.signal).toBe(ctrl.signal);
  });
});
