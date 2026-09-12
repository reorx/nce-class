import { DB_PATH, sqlite } from './client.js';
import { migrate, setAdmin } from './provision.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const username = arg('username');
const revoke = process.argv.includes('--revoke');

migrate(sqlite); // idempotent — adds teachers.is_admin on a database that predates it
const teachers = sqlite.prepare(`SELECT username, name, role, is_admin FROM teachers ORDER BY created_at`).all() as {
  username: string;
  name: string;
  role: string;
  is_admin: number;
}[];

if (!username || !teachers.some((t) => t.username === username)) {
  if (username) console.error(`✗ username not found: ${username}`);
  console.error(
    `Usage: pnpm --filter server set-admin -- --username <登录名> [--revoke]   (授予/撤销管理员，下一次请求即生效)`,
  );
  console.error(`Teachers in ${DB_PATH}:`);
  for (const t of teachers) console.error(`  ${t.username}  ${t.name} (${t.role})${t.is_admin ? '  [admin]' : ''}`);
  process.exit(1);
}

const { teacherId } = setAdmin(sqlite, { username, isAdmin: !revoke });
console.log(`✓ admin ${revoke ? 'revoked' : 'granted'}: ${username} (${teacherId}) → ${DB_PATH}`);
