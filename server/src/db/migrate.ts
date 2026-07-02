import { DB_PATH, sqlite } from './client.js';
import { migrate } from './provision.js';

migrate(sqlite);
console.log(`✓ schema applied (idempotent DDL) → ${DB_PATH}`);
