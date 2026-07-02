import { DB_PATH, sqlite } from './client.js';
import { createTeacher, migrate } from './provision.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const org = arg('org');
const name = arg('name');
const username = arg('username');
const password = arg('password');
const role = arg('role') ?? 'owner';

if (!org || !name || !username || !password) {
  console.error(
    `Usage: pnpm --filter server create-teacher -- --org <机构名> --name <老师名> --username <登录名> --password <密码> [--role owner|teacher]`,
  );
  process.exit(1);
}

migrate(sqlite); // idempotent — lets this run first on a brand-new volume
const { orgId, teacherId } = createTeacher(sqlite, { org, name, username, password, role });
console.log(`✓ teacher created: ${username} (${teacherId}) @ ${org} (${orgId}) → ${DB_PATH}`);
