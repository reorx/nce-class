// Storage abstraction layer — a single StorageClient interface; each vendor
// implements it with its own official SDK (see ../tenderbuddy approach).

export interface StorageConfig {
  vendor: string;
  endpoint: string;
  region?: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** Public base URL that fronts the bucket (CDN / bound domain); overrides URL building. */
  customDomain?: string;
}

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
}

export interface StorageClient {
  /** Upload an object and return its public/accessible URL. */
  putObject(input: PutObjectInput): Promise<string>;
  /** Resolve the accessible URL for a stored key. */
  getUrl(key: string): string;
  /** Delete an object by key. */
  deleteObject(key: string): Promise<void>;
}
