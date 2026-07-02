import { existsSync, mkdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PutObjectInput, StorageClient } from './base.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// NCE_UPLOAD_DIR overrides for tests (same pattern as NCE_DB_PATH in db/client).
const UPLOAD_DIR = process.env.NCE_UPLOAD_DIR || resolve(__dirname, '../../data/uploads');
const PUBLIC_BASE = process.env.STORAGE_PUBLIC_BASE || '/uploads';

// Local filesystem implementation — the default for development. Files are
// served statically by the Express app under PUBLIC_BASE.
export class LocalStorageClient implements StorageClient {
  constructor() {
    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  async putObject({ key, body }: PutObjectInput): Promise<string> {
    const dest = resolve(UPLOAD_DIR, key);
    if (!existsSync(dirname(dest))) mkdirSync(dirname(dest), { recursive: true });
    await writeFile(dest, body as any);
    return this.getUrl(key);
  }
  getUrl(key: string): string {
    return `${PUBLIC_BASE}/${key}`;
  }
  async deleteObject(key: string): Promise<void> {
    const dest = resolve(UPLOAD_DIR, key);
    if (existsSync(dest)) await unlink(dest);
  }
}

export { UPLOAD_DIR };
