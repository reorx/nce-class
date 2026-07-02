import { describe, expect, it } from 'vitest';
import type { StorageConfig } from '../src/storage/base.js';
import { createStorageClient } from '../src/storage/index.js';
import { LocalStorageClient } from '../src/storage/local.js';
import { MinioStorageClient } from '../src/storage/minio.js';
import { OssStorageClient } from '../src/storage/oss.js';

const base: Omit<StorageConfig, 'vendor'> = {
  endpoint: 'localhost:9000',
  bucket: 'nce',
  accessKey: 'ak',
  secretKey: 'sk',
};

describe('createStorageClient vendor switch', () => {
  it('defaults to local when vendor is unset', () => {
    expect(createStorageClient({ vendor: '' })).toBeInstanceOf(LocalStorageClient);
  });

  it('returns the minio client for vendor=minio', () => {
    expect(createStorageClient({ vendor: 'minio', ...base })).toBeInstanceOf(MinioStorageClient);
  });

  it('returns the oss client for vendor=oss', () => {
    expect(
      createStorageClient({
        vendor: 'oss',
        ...base,
        endpoint: 'oss-cn-hangzhou.aliyuncs.com',
        region: 'oss-cn-hangzhou',
      }),
    ).toBeInstanceOf(OssStorageClient);
  });

  it('throws on missing required config for a remote vendor', () => {
    expect(() => createStorageClient({ vendor: 'minio', bucket: 'nce' })).toThrow(/storage config/);
  });

  it('throws on an unknown vendor', () => {
    expect(() => createStorageClient({ vendor: 'gcs', ...base })).toThrow(/vendor/);
  });
});

describe('MinioStorageClient.getUrl', () => {
  it('builds a path-style http URL for a plain host:port endpoint', () => {
    const c = new MinioStorageClient({ vendor: 'minio', ...base });
    expect(c.getUrl('students/a.jpg')).toBe('http://localhost:9000/nce/students/a.jpg');
  });

  it('uses https when the endpoint carries the scheme', () => {
    const c = new MinioStorageClient({ vendor: 'minio', ...base, endpoint: 'https://minio.example.com' });
    expect(c.getUrl('k.png')).toBe('https://minio.example.com/nce/k.png');
  });

  it('prefers customDomain when set', () => {
    const c = new MinioStorageClient({ vendor: 'minio', ...base, customDomain: 'https://cdn.example.com' });
    expect(c.getUrl('k.png')).toBe('https://cdn.example.com/k.png');
  });
});

describe('OssStorageClient.getUrl', () => {
  it('builds a virtual-hosted https URL on an aliyuncs endpoint', () => {
    const c = new OssStorageClient({
      vendor: 'oss',
      ...base,
      endpoint: 'oss-cn-hangzhou.aliyuncs.com',
      region: 'oss-cn-hangzhou',
    });
    expect(c.getUrl('students/a.jpg')).toBe('https://nce.oss-cn-hangzhou.aliyuncs.com/students/a.jpg');
  });

  it('treats a non-aliyuncs endpoint as cname and uses it directly', () => {
    const c = new OssStorageClient({
      vendor: 'oss',
      ...base,
      endpoint: 'https://img.example.com',
      region: 'oss-cn-hangzhou',
    });
    expect(c.getUrl('k.png')).toBe('https://img.example.com/k.png');
  });

  it('prefers customDomain when set', () => {
    const c = new OssStorageClient({
      vendor: 'oss',
      ...base,
      endpoint: 'oss-cn-hangzhou.aliyuncs.com',
      region: 'oss-cn-hangzhou',
      customDomain: 'https://cdn.example.com/',
    });
    expect(c.getUrl('k.png')).toBe('https://cdn.example.com/k.png');
  });
});
