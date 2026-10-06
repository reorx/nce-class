import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../api/client';
import { loadErrorKind, loadErrorText, queryView } from './queryView';

describe('loadErrorText', () => {
  it('404 is "does not exist" and 403 is "no permission", neither offers a pointless retry', () => {
    expect(loadErrorText(new ApiError(404, 'batch not found'), '收款项')).toEqual({
      title: '收款项不存在或已被删除',
      detail: null,
      retry: false,
    });
    expect(loadErrorText(new ApiError(403, 'forbidden'), '管理页')).toEqual({
      title: '没有权限查看管理页',
      detail: null,
      retry: false,
    });
  });

  it('5xx and network failures are retryable and keep the reason', () => {
    expect(loadErrorText(new ApiError(500, '服务器错误'), '班级')).toEqual({
      title: '班级加载失败',
      detail: '服务器错误',
      retry: true,
    });
    expect(loadErrorKind(new NetworkError(new TypeError('x')))).toBe('network');
    expect(loadErrorText(new NetworkError(new TypeError('x')), '班级').retry).toBe(true);
  });
});

describe('queryView', () => {
  it('data wins over fetching and errors (cached content stays on screen)', () => {
    expect(queryView({ data: [], isError: false, fetchStatus: 'fetching' })).toBe('ready');
    expect(queryView({ data: [1], isError: true, fetchStatus: 'idle' })).toBe('ready');
  });

  it('no data: error, disabled (idle, not a forever spinner) or loading', () => {
    expect(queryView({ data: undefined, isError: true, fetchStatus: 'idle' })).toBe('error');
    expect(queryView({ data: undefined, isError: false, fetchStatus: 'idle' })).toBe('idle');
    expect(queryView({ data: undefined, isError: false, fetchStatus: 'fetching' })).toBe('loading');
    expect(queryView({ data: undefined, isError: false, fetchStatus: 'paused' })).toBe('loading');
  });
});
