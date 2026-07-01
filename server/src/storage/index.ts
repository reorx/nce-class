import type { StorageClient } from './base.js';
import { LocalStorageClient } from './local.js';

// createStorageClient() switches on S3_VENDOR. Minio (local) and OSS (prod)
// implementations plug in here once their SDKs are wired (see PRD §4). For M1
// the local filesystem client is the default so the app runs with no vendor.
export function createStorageClient(): StorageClient {
  const vendor = (process.env.S3_VENDOR || 'local').toLowerCase();
  switch (vendor) {
    case 'minio':
      // return new MinioStorageClient()  // TODO: wire `minio` SDK
      throw new Error('MinioStorageClient not wired yet (set S3_VENDOR=local)');
    case 'oss':
      // return new OssStorageClient()    // TODO: wire `ali-oss` SDK
      throw new Error('OssStorageClient not wired yet (set S3_VENDOR=local)');
    case 'local':
    default:
      return new LocalStorageClient();
  }
}

export const storageClient: StorageClient = createStorageClient();
export type { StorageClient } from './base.js';
