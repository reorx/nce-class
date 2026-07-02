import type { StorageClient, StorageConfig } from './base.js';
import { LocalStorageClient } from './local.js';
import { MinioStorageClient } from './minio.js';
import { OssStorageClient } from './oss.js';

// createStorageClient() switches on S3_VENDOR (see PRD §4). The local
// filesystem client stays the default so dev/test run with no vendor; remote
// vendors read the S3_* env vars, overridable for tests via `overrides`.
export function createStorageClient(overrides?: Partial<StorageConfig>): StorageClient {
  const config: StorageConfig = {
    vendor: (overrides?.vendor ?? process.env.S3_VENDOR ?? 'local').toLowerCase(),
    endpoint: overrides?.endpoint ?? process.env.S3_ENDPOINT ?? '',
    region: overrides?.region ?? process.env.S3_REGION,
    bucket: overrides?.bucket ?? process.env.S3_BUCKET ?? '',
    accessKey: overrides?.accessKey ?? process.env.S3_ACCESS_KEY ?? '',
    secretKey: overrides?.secretKey ?? process.env.S3_SECRET_KEY ?? '',
    customDomain: overrides?.customDomain ?? process.env.S3_CUSTOM_DOMAIN,
  };
  if (config.vendor === 'local' || config.vendor === '') return new LocalStorageClient();
  if (!config.endpoint || !config.bucket || !config.accessKey || !config.secretKey) {
    throw new Error(
      `invalid storage config for vendor ${config.vendor} (need S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY)`,
    );
  }
  switch (config.vendor) {
    case 'minio':
      return new MinioStorageClient(config);
    case 'oss':
      return new OssStorageClient(config);
    default:
      throw new Error(`invalid storage vendor: ${config.vendor}`);
  }
}

export const storageClient: StorageClient = createStorageClient();
export type { StorageClient } from './base.js';
