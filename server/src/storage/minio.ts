import * as Minio from 'minio';
import type { PutObjectInput, StorageClient, StorageConfig } from './base.js';

/** endpoint 'host[:port]' with optional scheme -> pieces the SDK + URL builder need. */
function parseEndpoint(endpoint: string): { host: string; port: number; useSSL: boolean } {
  const useSSL = endpoint.startsWith('https://') || (!endpoint.includes('://') && !endpoint.includes(':'));
  const clean = endpoint.replace(/^https?:\/\//, '');
  const [host, portStr] = clean.split(':');
  const port = portStr ? parseInt(portStr, 10) : useSSL ? 443 : 80;
  return { host, port, useSSL: useSSL || port === 443 };
}

// Minio (local/dev object storage). Buckets are made public-read in
// ensureBucket so getUrl can stay a synchronous string build — recap pages are
// long-lived, so expiring presigned URLs would rot inside stored photo links.
export class MinioStorageClient implements StorageClient {
  private client: Minio.Client;
  private config: StorageConfig;
  private baseUrl: string;

  constructor(config: StorageConfig) {
    this.config = config;
    const { host, port, useSSL } = parseEndpoint(config.endpoint);
    this.client = new Minio.Client({
      endPoint: host,
      port,
      useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: config.region,
    });
    const scheme = useSSL ? 'https' : 'http';
    const portSuffix = (useSSL && port === 443) || (!useSSL && port === 80) ? '' : `:${port}`;
    this.baseUrl = config.customDomain
      ? config.customDomain.replace(/\/$/, '')
      : `${scheme}://${host}${portSuffix}/${config.bucket}`;
  }

  async putObject({ key, body, contentType }: PutObjectInput): Promise<string> {
    const buf = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body);
    await this.client.putObject(
      this.config.bucket,
      key,
      buf,
      buf.length,
      contentType ? { 'Content-Type': contentType } : undefined,
    );
    return this.getUrl(key);
  }

  getUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.removeObject(this.config.bucket, key);
  }

  async ensureBucket(): Promise<void> {
    const bucket = this.config.bucket;
    const exists = await this.client.bucketExists(bucket);
    if (!exists) await this.client.makeBucket(bucket, this.config.region ?? 'us-east-1');
    await this.client.setBucketPolicy(
      bucket,
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucket}/*`],
          },
        ],
      }),
    );
  }
}
