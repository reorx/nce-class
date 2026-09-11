import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { DB_PATH, sqlite } from './client.js';
import { MIN_PASSWORD_LENGTH, resetPassword } from './provision.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

// Prompts go straight to stdout while readline's echo goes to a sink, so on a
// TTY (raw mode) the typed password never shows. Piped stdin works too, one line
// per prompt — the password stays out of argv and shell history. The async
// iterator buffers lines, so a second line arriving in the same chunk isn't lost.
function hiddenPrompt() {
  const sink = new Writable({ write: (_chunk, _enc, cb) => cb() });
  const rl = createInterface({ input: process.stdin, output: sink, terminal: Boolean(process.stdin.isTTY) });
  const lines = rl[Symbol.asyncIterator]();
  return {
    async ask(query: string): Promise<string | undefined> {
      process.stdout.write(query);
      const { value, done } = await lines.next();
      process.stdout.write('\n');
      return done ? undefined : value;
    },
    close: () => rl.close(),
  };
}

const username = arg('username');
const teachers = sqlite.prepare(`SELECT username, name, role FROM teachers ORDER BY created_at`).all() as {
  username: string;
  name: string;
  role: string;
}[];

if (!username || !teachers.some((t) => t.username === username)) {
  if (username) console.error(`✗ username not found: ${username}`);
  console.error(`Usage: pnpm --filter server reset-password -- --username <登录名>   (新密码交互输入两次，不回显)`);
  console.error(`Teachers in ${DB_PATH}:`);
  for (const t of teachers) console.error(`  ${t.username}  ${t.name} (${t.role})`);
  process.exit(1);
}

const prompt = hiddenPrompt();
const password = await prompt.ask('New password: ');
const confirm = password === undefined ? undefined : await prompt.ask('Confirm new password: ');
prompt.close();

if (password === undefined || confirm === undefined) fail('aborted');
if (password !== confirm) fail('passwords do not match');
if (password.length < MIN_PASSWORD_LENGTH) fail(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);

const { teacherId } = resetPassword(sqlite, { username, password });
console.log(`✓ password reset: ${username} (${teacherId}) → ${DB_PATH}`);
