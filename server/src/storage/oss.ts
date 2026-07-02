import OSS from 'ali-oss';
import type { PutObjectInput, StorageClient, StorageConfig } from './base.js';

// Aliyun OSS (production). Same public-read stance as the Minio client: the
// bucket must be readable so getUrl can build stable, non-expiring URLs.
// A non-aliyuncs endpoint means a bound custom domain (cname), per tenderbuddy.
export class OssStorageClient implements StorageClient {
  private client: OSS;
  private config: StorageConfig;
  private baseUrl: string;

  constructor(config: StorageConfig) {
    this.config = config;
    const cname = !config.endpoint.endsWith('.aliyuncs.com');
    this.client = new OSS({
      accessKeyId: config.accessKey,
      accessKeySecret: config.secretKey,
      region: config.region,
      bucket: config.bucket,
      endpoint: config.endpoint,
      cname,
    });
    const stripSlash = (s: string) => s.replace(/\/$/, '');
    if (config.customDomain) this.baseUrl = stripSlash(config.customDomain);
    else if (cname)
      this.baseUrl = stripSlash(config.endpoint.includes('://') ? config.endpoint : `https://${config.endpoint}`);
    else this.baseUrl = `https://${config.bucket}.${config.endpoint.replace(/^https?:\/\//, '')}`;
  }

  async putObject({ key, body, contentType }: PutObjectInput): Promise<string> {
    const buf = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body);
    await this.client.put(key, buf, contentType ? { headers: { 'Content-Type': contentType } } : undefined);
    return this.getUrl(key);
  }

  getUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.delete(key);
  }
}
